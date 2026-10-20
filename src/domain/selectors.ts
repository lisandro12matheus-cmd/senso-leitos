import type { Admission, AppState, Bed, BedStatus, BedType, Hospital, Movement } from './types';
import { countByStatus } from './logic';
import { HISTORY_START_OFFSET_MINUTES } from './seed';

export interface Filters {
  hospitalId?: string;
  blockId?: string;
  type?: BedType | '';
  status?: BedStatus | '';
  query?: string;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();

export function searchMatches(value: string, query: string): boolean {
  return normalize(value).includes(normalize(query));
}

export function selectBeds(state: AppState, filters: Filters = {}): Bed[] {
  const patient = new Map(state.patients.map((entry) => [entry.id, entry]));
  const admissions = new Map(state.admissions.filter((entry) => entry.status === 'active').map((entry) => [entry.id, entry]));
  const q = filters.query?.trim();
  return state.beds.filter((bed) => {
    if (filters.hospitalId && bed.hospitalId !== filters.hospitalId) return false;
    if (filters.blockId && bed.blockId !== filters.blockId) return false;
    if (filters.type && bed.type !== filters.type) return false;
    if (filters.status && bed.status !== filters.status) return false;
    if (!q) return true;
    const admission = bed.currentAdmissionId ? admissions.get(bed.currentAdmissionId) : undefined;
    const person = admission ? patient.get(admission.patientId) : undefined;
    const fields = [bed.code, bed.id, person?.displayName, person?.socialName, person?.localRecord, person?.documentValue].filter(Boolean).join(' ');
    return searchMatches(fields, q);
  });
}

export function selectCounts(state: AppState, filters: Filters = {}) {
  const beds = selectBeds(state, { hospitalId: filters.hospitalId, blockId: filters.blockId, type: filters.type });
  const counts = countByStatus(beds);
  const total = beds.length;
  const active = total - counts.maintenance - counts.blocked;
  return { ...counts, total, active, occupancy: active === 0 ? null : counts.occupied / active * 100 };
}

export function selectHospitals(state: AppState, hospitalId?: string): Hospital[] {
  return hospitalId ? state.hospitals.filter((hospital) => hospital.id === hospitalId) : state.hospitals;
}

export function selectActiveAdmissions(state: AppState, query = '', hospitalId?: string): Admission[] {
  const patients = new Map(state.patients.map((patient) => [patient.id, patient]));
  const beds = new Map(state.beds.map((bed) => [bed.id, bed]));
  const hospitals = new Map(state.hospitals.map((hospital) => [hospital.id, hospital]));
  return state.admissions.filter((admission) => {
    if (admission.status !== 'active' || (hospitalId && admission.hospitalId !== hospitalId)) return false;
    if (!query.trim()) return true;
    const person = patients.get(admission.patientId);
    const bed = beds.get(admission.currentBedId ?? '');
    const address = person?.address;
    return searchMatches([
      person?.displayName, person?.socialName, person?.localRecord, person?.documentValue, person?.contact,
      person?.guardian, address?.street, address?.number, address?.district, address?.city, address?.state,
      bed?.code, admission.id, admission.reason, admission.procedureCode, admission.procedureDescription,
      hospitals.get(admission.hospitalId)?.name,
    ].filter(Boolean).join(' '), query);
  }).sort((a, b) => b.admittedAt.localeCompare(a.admittedAt));
}

export function selectMovements(state: AppState, filters: { hospitalId?: string; query?: string } = {}): Movement[] {
  const beds = new Map(state.beds.map((bed) => [bed.id, bed]));
  return [...state.movements].filter((event) => {
    if (filters.hospitalId && event.hospitalId !== filters.hospitalId) return false;
    if (filters.query?.trim()) {
      const bed = event.bedId ? beds.get(event.bedId) : undefined;
      return searchMatches([bed?.code, event.reason, event.actor, event.type].filter(Boolean).join(' '), filters.query);
    }
    return true;
  }).sort((a, b) => b.happenedAt.localeCompare(a.happenedAt));
}

function zonedParts(date: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return Object.fromEntries(values.map((part) => [part.type, part.value]));
}

export function dateKey(date: Date, timeZone = 'America/Belem'): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateInstant(key: string, timeZone = 'America/Belem'): number {
  const [year, month, day] = key.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day);
  let candidate = desired;
  for (let pass = 0; pass < 4; pass += 1) {
    const observed = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(Number(observed.year), Number(observed.month) - 1, Number(observed.day));
    candidate += desired - represented;
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(candidate));
    const offset = Object.fromEntries(hour.map((part) => [part.type, part.value]));
    const actualMinutes = Number(offset.hour) * 60 + Number(offset.minute);
    if (actualMinutes === 0) break;
    candidate -= actualMinutes * 60_000;
  }
  return candidate;
}

export interface DailySummary {
  date: string;
  hospitalId?: string;
  partial: boolean;
  until: string;
  admissions: number;
  discharges: Record<string, number>;
  transferIns: number;
  transferOuts: number;
  census: number;
  byStatus: Record<BedStatus, number>;
}

export function selectDailySummary(state: AppState, day: string, hospitalId?: string, now = Date.now()): DailySummary | null {
  const dayStart = localDateInstant(day);
  const tomorrow = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + 1));
  const nextKey = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth()+1).padStart(2,'0')}-${String(tomorrow.getUTCDate()).padStart(2,'0')}`;
  const endOfDay = localDateInstant(nextKey);
  const isToday = day === dateKey(new Date(now));
  if (dayStart > now) return null;
  if (dayStart < Date.parse(state.initializedAt) + HISTORY_START_OFFSET_MINUTES * 60_000) return null;
  const cutoff = isToday ? now : endOfDay;
  const beds = hospitalId ? state.beds.filter((bed) => bed.hospitalId === hospitalId) : state.beds;
  const bedIds = new Set(beds.map((bed) => bed.id));
  const stateByBed = new Map<string, BedStatus>();
  const ordered = [...state.movements].filter((event) => event.bedId && bedIds.has(event.bedId) && Date.parse(event.happenedAt) < cutoff)
    .sort((a,b) => a.happenedAt.localeCompare(b.happenedAt) || a.id.localeCompare(b.id));
  for (const event of ordered) if (event.bedId && event.toStatus) stateByBed.set(event.bedId, event.toStatus);
  const empty: Record<BedStatus, number> = { available: 0, occupied: 0, reserved: 0, cleaning: 0, maintenance: 0, blocked: 0 };
  for (const status of stateByBed.values()) empty[status] += 1;
  const eventsToday = state.movements.filter((event) => event.bedId && bedIds.has(event.bedId) && Date.parse(event.happenedAt) >= dayStart && Date.parse(event.happenedAt) < cutoff);
  const outcomeLabels: Record<string, string> = { discharge: 'Alta', external_transfer: 'Transferência externa', evasion: 'Evasão', death: 'Óbito', other: 'Outro' };
  const discharges: Record<string, number> = { 'Alta': 0, 'Transferência externa': 0, 'Evasão': 0, 'Óbito': 0, 'Outro': 0 };
  const admissions = eventsToday.filter((event) => event.type === 'admission').length;
  const closedIds = new Set(eventsToday.filter((event) => event.type === 'discharge' && event.admissionId).map((event) => event.admissionId));
  for (const id of closedIds) {
    const admission = state.admissions.find((entry) => entry.id === id);
    if (admission?.dischargeType) discharges[outcomeLabels[admission.dischargeType]] += 1;
  }
  return {
    date: day, hospitalId, partial: isToday,
    until: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit' }).format(new Date(cutoff)),
    admissions, discharges,
    transferIns: eventsToday.filter((event) => event.type === 'transfer_in').length,
    transferOuts: eventsToday.filter((event) => event.type === 'transfer_out').length,
    census: empty.occupied, byStatus: empty,
  };
}


