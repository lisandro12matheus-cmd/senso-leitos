import { createId, DEMO_ACTOR } from './seed';
import {
  type Admission, type AppState, type Bed, type BedStatus, type BedType, type Blockage,
  type Cleaning, type DischargeType, type Hospital, type Maintenance, type Movement,
  type Origin, type Patient, type Reservation,
} from './types';

export class DomainError extends Error {
  constructor(message: string) { super(message); this.name = 'DomainError'; }
}

function requireBed(state: AppState, bedId: string): Bed {
  const bed = state.beds.find((entry) => entry.id === bedId);
  if (!bed) throw new DomainError('Esse leito não está mais disponível. Atualize o mapa e tente novamente.');
  return bed;
}

function moveBed(state: AppState, bed: Bed, status: BedStatus, kind: Movement['type'], at: string, detail: {
  admissionId?: string | null; patientId?: string | null; reason?: string | null; relatedBedId?: string | null; operationId?: string;
} = {}): Movement {
  const previous = bed.status;
  const operationId = detail.operationId ?? createId('op');
  bed.status = status;
  bed.statusChangedAt = at;
  bed.revision += 1;
  const movement: Movement = {
    id: createId('evt'), operationId, type: kind, happenedAt: at, recordedAt: new Date().toISOString(),
    hospitalId: bed.hospitalId, bedId: bed.id, admissionId: detail.admissionId ?? null,
    patientId: detail.patientId ?? null, fromStatus: previous, toStatus: status,
    actor: DEMO_ACTOR, reason: detail.reason ?? null, relatedBedId: detail.relatedBedId ?? null,
  };
  state.movements.push(movement);
  return movement;
}

function assertState(state: AppState): void {
  const hospitalIds = new Set(state.hospitals.map((item) => item.id));
  const blockMap = new Map(state.blocks.map((block) => [block.id, block]));
  const active = state.admissions.filter((item) => item.status === 'active');
  if (new Set(active.map((item) => item.patientId)).size !== active.length) throw new DomainError('O paciente já possui uma internação ativa.');
  if (new Set(active.map((item) => item.currentBedId)).size !== active.length) throw new DomainError('O leito selecionado já está vinculado a outra internação.');
  for (const bed of state.beds) {
    const block = blockMap.get(bed.blockId);
    if (!hospitalIds.has(bed.hospitalId) || !block || block.hospitalId !== bed.hospitalId) throw new DomainError(`Confira o hospital e o bloco do leito ${bed.code}.`);
    const openAllocations = state.allocations.filter((item) => item.bedId === bed.id && !item.endedAt);
    const activeMaintenance = state.maintenances.filter((item) => item.bedId === bed.id && item.status === 'open');
    const activeCleaning = state.cleanings.filter((item) => item.bedId === bed.id && item.status === 'pending');
    const activeReservations = state.reservations.filter((item) => item.bedId === bed.id && item.status === 'active');
    const activeBlockages = state.blockages.filter((item) => item.bedId === bed.id && item.status === 'open');
    if (bed.status === 'occupied') {
      const admission = active.find((item) => item.id === bed.currentAdmissionId && item.currentBedId === bed.id);
      if (!admission || openAllocations.length !== 1 || openAllocations[0].admissionId !== admission.id) throw new DomainError(`A internação do leito ${bed.code} precisa ser revisada.`);
    } else if (bed.currentAdmissionId || openAllocations.length) {
      throw new DomainError(`O leito ${bed.code} ainda tem uma internação vinculada.`);
    }
    if (bed.status === 'maintenance' !== (activeMaintenance.length === 1)) throw new DomainError(`Confira o registro de manutenção do leito ${bed.code}.`);
    if (bed.status === 'cleaning' !== (activeCleaning.length === 1)) throw new DomainError(`Confira o registro de higienização do leito ${bed.code}.`);
    if (bed.status === 'reserved' !== (activeReservations.length === 1)) throw new DomainError(`Confira a reserva do leito ${bed.code}.`);
    if (bed.status === 'blocked' !== (activeBlockages.length === 1)) throw new DomainError(`Confira o bloqueio do leito ${bed.code}.`);
  }
}

function mutate(current: AppState, operation: (next: AppState, now: string) => string): { state: AppState; message: string } {
  const next = structuredClone(current);
  const now = new Date().toISOString();
  const message = operation(next, now);
  next.revision = current.revision + 1;
  next.updatedAt = now;
  assertState(next);
  return { state: next, message };
}

export interface AdmissionInput {
  patientId?: string;
  patient?: Omit<Patient, 'id' | 'localRecord' | 'synthetic'>;
  hospitalId: string;
  bedId: string;
  type: BedType;
  origin: Origin;
  reason: string;
  procedureCode?: string;
  procedureDescription?: string;
  admittedAt?: string;
  reservationId?: string;
}

export function admitPatient(current: AppState, input: AdmissionInput) {
  return mutate(current, (state, now) => {
    const bed = requireBed(state, input.bedId);
    const reservation = input.reservationId ? state.reservations.find((item) => item.id === input.reservationId && item.bedId === bed.id && item.status === 'active') : undefined;
    if (bed.status !== 'available' && !(bed.status === 'reserved' && reservation)) throw new DomainError('Este leito não está disponível. Escolha outro e revise a situação.');
    if (bed.hospitalId !== input.hospitalId || bed.type !== input.type) throw new DomainError('Confira hospital e tipo de leito antes de confirmar a entrada.');
    const hospital = state.hospitals.find((item) => item.id === input.hospitalId);
    if (!hospital) throw new DomainError('Selecione um hospital válido.');
    let patientId = input.patientId;
    if (!patientId) {
      if (!input.patient) throw new DomainError('Informe os dados do paciente ou selecione um cadastro existente.');
      if (!input.patient.displayName.trim()) throw new DomainError('Informe o nome do paciente.');
      patientId = createId('PAC');
      state.patients.push({ ...input.patient, id: patientId, localRecord: `LV-${Date.now().toString(36).toUpperCase()}`, synthetic: true });
    } else if (!state.patients.some((item) => item.id === patientId)) {
      throw new DomainError('O cadastro do paciente não foi encontrado. Pesquise novamente.');
    }
    if (state.admissions.some((item) => item.patientId === patientId && item.status === 'active')) throw new DomainError('Este paciente já possui uma internação ativa.');
    if (bed.status === 'reserved') {
      if (!reservation) throw new DomainError('Este leito está reservado. Confirme a entrada pela reserva correspondente.');
      reservation.status = 'used';
      reservation.closedAt = now;
    }
    const admittedAt = input.admittedAt ? new Date(input.admittedAt).toISOString() : now;
    if (!Number.isFinite(Date.parse(admittedAt)) || Date.parse(admittedAt) > Date.parse(now)) throw new DomainError('A entrada deve ter um horário válido, até agora.');
    if (Date.parse(admittedAt) < Date.parse(bed.statusChangedAt)) throw new DomainError('A entrada deve ser posterior à última mudança deste leito.');
    const admissionId = createId('ADM');
    const admission: Admission = {
      id: admissionId, patientId, hospitalId: input.hospitalId, currentBedId: bed.id,
      admittedAt, origin: input.origin, reason: input.reason.trim(),
      procedureCode: input.procedureCode?.trim() || null,
      procedureDescription: input.procedureDescription?.trim() || null, status: 'active',
    };
    state.admissions.push(admission);
    state.allocations.push({ id: createId('ALOC'), admissionId, bedId: bed.id, startedAt: now });
    bed.currentAdmissionId = admissionId;
    moveBed(state, bed, 'occupied', 'admission', now, { admissionId, patientId, reason: input.reason });
    return `Entrada registrada em ${hospital.name}, leito ${bed.code}.`;
  });
}

export interface DischargeInput { admissionId: string; dischargeType: DischargeType; dischargedAt?: string; destination?: string; note?: string; }

export function dischargePatient(current: AppState, input: DischargeInput) {
  return mutate(current, (state, now) => {
    const admission = state.admissions.find((item) => item.id === input.admissionId && item.status === 'active');
    if (!admission?.currentBedId) throw new DomainError('Essa internação já foi encerrada ou não foi encontrada. Atualize a lista.');
    const bed = requireBed(state, admission.currentBedId);
    if (bed.status !== 'occupied' || bed.currentAdmissionId !== admission.id) throw new DomainError('A situação do leito mudou. Revise a internação antes de confirmar.');
    if (input.dischargeType === 'external_transfer' && !input.destination?.trim()) throw new DomainError('Informe o destino da transferência externa.');
    if (input.dischargeType === 'other' && !input.note?.trim()) throw new DomainError('Descreva o motivo da saída.');
    const dischargedAt = input.dischargedAt ? new Date(input.dischargedAt).toISOString() : now;
    if (!Number.isFinite(Date.parse(dischargedAt)) || Date.parse(dischargedAt) > Date.parse(now) || Date.parse(dischargedAt) < Date.parse(admission.admittedAt) || Date.parse(dischargedAt) < Date.parse(bed.statusChangedAt)) throw new DomainError('A saída deve ocorrer depois da entrada e da última mudança do leito.');
    admission.status = 'closed';
    admission.currentBedId = null;
    admission.dischargedAt = dischargedAt;
    admission.dischargeType = input.dischargeType;
    admission.destination = input.destination?.trim() || undefined;
    admission.notes = input.note?.trim() || admission.notes;
    const allocation = state.allocations.find((item) => item.admissionId === admission.id && item.bedId === bed.id && !item.endedAt);
    if (!allocation) throw new DomainError('A alocação do leito precisa ser revisada antes de registrar a saída.');
    allocation.endedAt = dischargedAt;
    bed.currentAdmissionId = null;
    moveBed(state, bed, 'cleaning', 'discharge', dischargedAt, { admissionId: admission.id, patientId: admission.patientId, reason: input.dischargeType });
    state.cleanings.push({ id: createId('clean'), bedId: bed.id, reason: 'Higienização após saída física', startedAt: dischargedAt, responsible: null, status: 'pending' });
    return `Saída registrada. O leito ${bed.code} foi enviado para higienização.`;
  });
}

export function transferPatientInternally(current: AppState, admissionId: string, targetBedId: string, reason: string) {
  return mutate(current, (state, now) => {
    const admission = state.admissions.find((item) => item.id === admissionId && item.status === 'active');
    if (!admission?.currentBedId) throw new DomainError('A internação ativa não foi encontrada. Atualize e tente novamente.');
    const source = requireBed(state, admission.currentBedId);
    const target = requireBed(state, targetBedId);
    if (source.id === target.id) throw new DomainError('Escolha um leito de destino diferente.');
    if (target.hospitalId !== admission.hospitalId) throw new DomainError('Transferências entre hospitais seguem o fluxo externo nesta demonstração.');
    if (target.status !== 'available') throw new DomainError('O leito de destino não está disponível.');
    if (!reason.trim()) throw new DomainError('Informe o motivo da transferência interna.');
    const original = state.allocations.find((item) => item.admissionId === admission.id && item.bedId === source.id && !item.endedAt);
    if (!original) throw new DomainError('A alocação de origem precisa ser revisada.');
    original.endedAt = now;
    source.currentAdmissionId = null;
    const targetAdmission = admission;
    admission.currentBedId = target.id;
    state.allocations.push({ id: createId('ALOC'), admissionId: admission.id, bedId: target.id, startedAt: now });
    const operationId = createId('op-transfer');
    moveBed(state, source, 'cleaning', 'transfer_out', now, { admissionId, patientId: admission.patientId, reason: reason.trim(), relatedBedId: target.id, operationId });
    state.cleanings.push({ id: createId('clean'), bedId: source.id, reason: 'Higienização após transferência interna', startedAt: now, responsible: null, status: 'pending' });
    moveBed(state, target, 'occupied', 'transfer_in', now, { admissionId, patientId: admission.patientId, reason: reason.trim(), relatedBedId: source.id, operationId });
    target.currentAdmissionId = targetAdmission.id;
    return `Paciente transferido para ${target.code}; o leito de origem foi enviado para higienização.`;
  });
}

export function reserveBed(current: AppState, bedId: string, responsible: string, expectedAt: string, protocol?: string) {
  return mutate(current, (state, now) => {
    const bed = requireBed(state, bedId);
    if (bed.status !== 'available') throw new DomainError('Somente leitos disponíveis podem ser reservados.');
    if (!responsible.trim()) throw new DomainError('Informe quem acompanha esta reserva.');
    const expected = new Date(expectedAt).toISOString();
    if (Date.parse(expected) < Date.parse(now)) throw new DomainError('A previsão da reserva precisa estar no futuro.');
    const reservation: Reservation = { id: createId('RES'), bedId, protocol: protocol?.trim() || `REG-${Date.now().toString(36).toUpperCase()}`, createdAt: now, expectedArrivalAt: expected, responsible: responsible.trim(), status: 'active' };
    state.reservations.push(reservation);
    moveBed(state, bed, 'reserved', 'reserve', now, { reason: `Reserva ${reservation.protocol}` });
    return `Leito ${bed.code} reservado com protocolo ${reservation.protocol}.`;
  });
}

export function cancelReservation(current: AppState, bedId: string, reason: string) {
  return mutate(current, (state, now) => {
    const bed = requireBed(state, bedId);
    const reservation = state.reservations.find((item) => item.bedId === bed.id && item.status === 'active');
    if (bed.status !== 'reserved' || !reservation) throw new DomainError('A reserva não está mais ativa. Atualize o mapa.');
    if (!reason.trim()) throw new DomainError('Registre o motivo do cancelamento.');
    reservation.status = 'cancelled'; reservation.closedAt = now; reservation.cancellationReason = reason.trim();
    moveBed(state, bed, 'available', 'reservation_cancel', now, { reason: reason.trim() });
    return `Reserva ${reservation.protocol} cancelada.`;
  });
}

export function completeCleaning(current: AppState, bedId: string, responsible: string) {
  return mutate(current, (state, now) => {
    const bed = requireBed(state, bedId);
    const cleaning = state.cleanings.find((item) => item.bedId === bed.id && item.status === 'pending');
    if (bed.status !== 'cleaning' || !cleaning) throw new DomainError('Esse leito não tem higienização pendente.');
    cleaning.status = 'completed'; cleaning.finishedAt = now; cleaning.responsible = responsible.trim() || DEMO_ACTOR;
    moveBed(state, bed, 'available', 'cleaning_complete', now, { reason: 'Higienização e conferência concluídas.' });
    return `Leito ${bed.code} liberado e disponível para nova entrada.`;
  });
}

export function startMaintenance(current: AppState, bedId: string, reason: string, responsible: string, expectedEndAt?: string) {
  return mutate(current, (state, now) => {
    const bed = requireBed(state, bedId);
    if (!['available', 'cleaning'].includes(bed.status)) throw new DomainError('Este leito precisa estar disponível ou em higienização antes de entrar em manutenção.');
    if (!reason.trim() || !responsible.trim()) throw new DomainError('Informe o motivo e a pessoa responsável.');
    const endAt = expectedEndAt ? new Date(expectedEndAt).toISOString() : null;
    if (endAt && Date.parse(endAt) < Date.parse(now)) throw new DomainError('A previsão precisa ser no futuro.');
    const task = state.cleanings.find((item) => item.bedId === bed.id && item.status === 'pending');
    if (task) { task.status = 'cancelled'; task.completionNote = 'Suspensa para manutenção.'; }
    state.maintenances.push({ id: createId('MNT'), bedId, reason: reason.trim(), responsible: responsible.trim(), startedAt: now, expectedEndAt: endAt, status: 'open' });
    moveBed(state, bed, 'maintenance', 'maintenance_start', now, { reason: reason.trim() });
    return `Manutenção iniciada no leito ${bed.code}.`;
  });
}

export function finishMaintenance(current: AppState, bedId: string, note: string) {
  return mutate(current, (state, now) => {
    const bed = requireBed(state, bedId);
    const maintenance = state.maintenances.find((item) => item.bedId === bed.id && item.status === 'open');
    if (bed.status !== 'maintenance' || !maintenance) throw new DomainError('A manutenção deste leito não está mais aberta.');
    if (!note.trim()) throw new DomainError('Descreva o que foi concluído ou verificado.');
    maintenance.status = 'closed'; maintenance.finishedAt = now; maintenance.completionNote = note.trim();
    state.cleanings.push({ id: createId('clean'), bedId: bed.id, reason: 'Higienização e conferência após manutenção', startedAt: now, responsible: null, status: 'pending' });
    moveBed(state, bed, 'cleaning', 'maintenance_complete', now, { reason: note.trim() });
    return `Manutenção concluída. O leito ${bed.code} foi enviado para higienização.`;
  });
}

export function blockBed(current: AppState, bedId: string, reason: string, responsible: string) {
  return mutate(current, (state, now) => {
    const bed = requireBed(state, bedId);
    if (!['available', 'cleaning'].includes(bed.status)) throw new DomainError('Somente leitos disponíveis ou em higienização podem ser bloqueados.');
    if (!reason.trim() || !responsible.trim()) throw new DomainError('Informe o motivo do bloqueio e a pessoa responsável.');
    const cleaning = state.cleanings.find((item) => item.bedId === bed.id && item.status === 'pending');
    if (cleaning) { cleaning.status = 'cancelled'; cleaning.completionNote = 'Suspensa pelo bloqueio.'; }
    state.blockages.push({ id: createId('BLK'), bedId, reason: reason.trim(), responsible: responsible.trim(), startedAt: now, status: 'open' });
    moveBed(state, bed, 'blocked', 'block', now, { reason: reason.trim() });
    return `Leito ${bed.code} bloqueado e indisponível para entradas.`;
  });
}

export function unblockBed(current: AppState, bedId: string, reason: string) {
  return mutate(current, (state, now) => {
    const bed = requireBed(state, bedId);
    const blockage = state.blockages.find((item) => item.bedId === bed.id && item.status === 'open');
    if (bed.status !== 'blocked' || !blockage) throw new DomainError('Esse leito não está mais bloqueado.');
    if (!reason.trim()) throw new DomainError('Informe o motivo da retirada do bloqueio.');
    blockage.status = 'closed'; blockage.endedAt = now;
    state.cleanings.push({ id: createId('clean'), bedId, reason: `Conferência após desbloqueio: ${reason.trim()}`, startedAt: now, responsible: null, status: 'pending' });
    moveBed(state, bed, 'cleaning', 'unblock', now, { reason: reason.trim() });
    return `Bloqueio removido. O leito ${bed.code} foi enviado para higienização.`;
  });
}

export function confirmHospitalMap(current: AppState, hospitalId: string) {
  return mutate(current, (state, now) => {
    const hospital = state.hospitals.find((item) => item.id === hospitalId) as Hospital | undefined;
    if (!hospital) throw new DomainError('Selecione um hospital da demonstração.');
    hospital.lastVerifiedAt = now;
    state.movements.push({ id: createId('evt'), operationId: createId('op'), type: 'hospital_confirm', happenedAt: now, recordedAt: now, hospitalId, actor: DEMO_ACTOR, reason: 'Mapa conferido pela equipe de demonstração.' });
    return `Situação registrada como conferida para ${hospital.name}.`;
  });
}

export function patientForAdmission(state: AppState, admission: Admission): Patient | undefined {
  return state.patients.find((item) => item.id === admission.patientId);
}

export function bedForAdmission(state: AppState, admission: Admission): Bed | undefined {
  return admission.currentBedId ? state.beds.find((item) => item.id === admission.currentBedId) : undefined;
}

export function getCleaning(state: AppState, bedId: string): Cleaning | undefined {
  return state.cleanings.find((item) => item.bedId === bedId && item.status === 'pending');
}

export function getMaintenance(state: AppState, bedId: string): Maintenance | undefined {
  return state.maintenances.find((item) => item.bedId === bedId && item.status === 'open');
}

export function getReservation(state: AppState, bedId: string): Reservation | undefined {
  return state.reservations.find((item) => item.bedId === bedId && item.status === 'active');
}

export function getBlockage(state: AppState, bedId: string): Blockage | undefined {
  return state.blockages.find((item) => item.bedId === bedId && item.status === 'open');
}

export function countByStatus(beds: Bed[]): Record<BedStatus, number> {
  const counts: Record<BedStatus, number> = { available: 0, occupied: 0, reserved: 0, cleaning: 0, maintenance: 0, blocked: 0 };
  for (const bed of beds) counts[bed.status] += 1;
  return counts;
}

export function validateState(state: AppState): void { assertState(state); }

