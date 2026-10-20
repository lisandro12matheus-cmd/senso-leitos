import { create } from 'zustand';
import { z } from 'zod';
import { createDemoState, createId, parseStoredState, STORAGE_KEY } from '../domain/seed';
import {
  admitPatient, blockBed, cancelReservation, completeCleaning, confirmHospitalMap, dischargePatient,
  DomainError, finishMaintenance, reserveBed, startMaintenance, transferPatientInternally,
  unblockBed, validateState, type AdmissionInput, type DischargeInput,
} from '../domain/logic';
import type { AppState, BedType, CommandResult, Origin, Patient } from '../domain/types';

const stringRecord = z.object({ id: z.string() }).passthrough();
const persistedSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().min(1),
  initializedAt: z.string(), updatedAt: z.string(),
  hospitals: z.array(stringRecord), blocks: z.array(stringRecord), beds: z.array(stringRecord),
  patients: z.array(stringRecord), admissions: z.array(stringRecord), allocations: z.array(stringRecord),
  reservations: z.array(stringRecord), maintenances: z.array(stringRecord), cleanings: z.array(stringRecord),
  blockages: z.array(stringRecord), movements: z.array(stringRecord),
});

function loadState(): { app: AppState; error: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { app: createDemoState(), error: null };
    const parsed = parseStoredState(raw);
    const validation = persistedSchema.safeParse(parsed);
    if (!validation.success) throw new Error('Os dados salvos não passaram pela conferência de formato. Baixe uma cópia ou restaure a demonstração.');
    validateState(parsed);
    return { app: parsed, error: null };
  } catch (error) {
    return { app: createDemoState(), error: error instanceof Error ? error.message : 'Não foi possível ler os dados salvos.' };
  }
}

export interface NewPatientInput {
  displayName: string; socialName?: string; birthDate?: string; unidentified: boolean;
  address?: { street?: string; number?: string; district?: string; city?: string; state?: string };
  guardian?: string;
}

export interface StoreActions {
  run(operation: (current: AppState) => { state: AppState; message: string }): Promise<CommandResult>;
  admit(input: AdmissionInput): Promise<CommandResult>;
  discharge(input: DischargeInput): Promise<CommandResult>;
  transfer(admissionId: string, targetBedId: string, reason: string): Promise<CommandResult>;
  reserve(bedId: string, responsible: string, expectedAt: string, protocol?: string): Promise<CommandResult>;
  cancelReservation(bedId: string, reason: string): Promise<CommandResult>;
  completeCleaning(bedId: string, responsible: string): Promise<CommandResult>;
  startMaintenance(bedId: string, reason: string, responsible: string, expectedAt?: string): Promise<CommandResult>;
  finishMaintenance(bedId: string, note: string): Promise<CommandResult>;
  block(bedId: string, reason: string, responsible: string): Promise<CommandResult>;
  unblock(bedId: string, reason: string): Promise<CommandResult>;
  confirmMap(hospitalId: string): Promise<CommandResult>;
  reset(): Promise<CommandResult>;
  dismissStorageError(): void;
  setStorageError(message: string | null): void;
}

export type LeitoStore = { app: AppState; storageError: string | null } & StoreActions;

const initial = loadState();

export const useLeitoStore = create<LeitoStore>((set, get) => {
  const commit = async (reduce: (current: AppState) => { state: AppState; message: string }): Promise<CommandResult> => {
    const apply = (): CommandResult => {
      try {
        const current = get().app;
        const persisted = localStorage.getItem(STORAGE_KEY);
        if (persisted) {
          let remote: AppState;
          try { remote = parseStoredState(persisted); }
          catch { throw new DomainError('Os dados salvos mudaram ou estão inválidos. Recupere uma cópia antes de tentar novamente.'); }
          if (remote.revision !== current.revision) {
            set({ app: remote, storageError: null });
            throw new DomainError('A situação mudou em outra aba. Atualizei os dados; revise a ação antes de confirmar.');
          }
        } else if (current.revision > 1) {
          throw new DomainError('Os dados mudaram em outra aba. Revise a ação antes de continuar.');
        }
        const result = reduce(current);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(result.state)); }
        catch { throw new DomainError('Não foi possível salvar neste navegador. Seus dados atuais continuam visíveis; libere espaço e tente novamente.'); }
        set({ app: result.state, storageError: null });
        return { ok: true, message: result.message };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Não foi possível concluir a operação.' };
      }
    };
    try {
      if ('locks' in navigator && navigator.locks) return await navigator.locks.request(STORAGE_KEY, { mode: 'exclusive' }, apply);
      return apply();
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Não foi possível atualizar os dados.' };
    }
  };

  return {
    app: initial.app,
    storageError: initial.error,
    run: commit,
    admit: (input) => commit((state) => admitPatient(state, input)),
    discharge: (input) => commit((state) => dischargePatient(state, input)),
    transfer: (admissionId, target, reason) => commit((state) => transferPatientInternally(state, admissionId, target, reason)),
    reserve: (bedId, responsible, expected, protocol) => commit((state) => reserveBed(state, bedId, responsible, expected, protocol)),
    cancelReservation: (bedId, reason) => commit((state) => cancelReservation(state, bedId, reason)),
    completeCleaning: (bedId, responsible) => commit((state) => completeCleaning(state, bedId, responsible)),
    startMaintenance: (bedId, reason, responsible, expected) => commit((state) => startMaintenance(state, bedId, reason, responsible, expected)),
    finishMaintenance: (bedId, note) => commit((state) => finishMaintenance(state, bedId, note)),
    block: (bedId, reason, responsible) => commit((state) => blockBed(state, bedId, reason, responsible)),
    unblock: (bedId, reason) => commit((state) => unblockBed(state, bedId, reason)),
    confirmMap: (hospitalId) => commit((state) => confirmHospitalMap(state, hospitalId)),
    reset: () => commit(() => ({ state: createDemoState(), message: 'A demonstração foi restaurada para os dados de exemplo.' })),
    dismissStorageError: () => set({ storageError: null }),
    setStorageError: (message) => set({ storageError: message }),
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const next = parseStoredState(event.newValue);
      const validation = persistedSchema.safeParse(next);
      if (!validation.success) return;
      validateState(next);
      if (next.revision > useLeitoStore.getState().app.revision) useLeitoStore.setState({ app: next, storageError: null });
    } catch {
      useLeitoStore.getState().setStorageError('Outra aba salvou dados inválidos. Baixe uma cópia antes de continuar.');
    }
  });
}

export function savePatientDetails(patientId: string, input: Partial<Patient>) {
  return useLeitoStore.getState().run((current) => {
    const next = structuredClone(current);
    const patient = next.patients.find((item) => item.id === patientId);
    if (!patient) throw new DomainError('Paciente não encontrado.');
    if (input.displayName !== undefined) patient.displayName = input.displayName.trim();
    if (input.socialName !== undefined) patient.socialName = input.socialName || null;
    if (input.address !== undefined) patient.address = input.address as Patient['address'];
    if (input.guardian !== undefined) patient.guardian = input.guardian || null;
    if (!patient.displayName.trim()) throw new DomainError('Informe o nome do paciente.');
    next.revision = current.revision + 1;
    next.updatedAt = new Date().toISOString();
    return { state: next, message: 'Cadastro complementar atualizado.' };
  });
}

export { createId };
export type { BedType, Origin };

