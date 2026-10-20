export type BedStatus = 'available' | 'occupied' | 'reserved' | 'cleaning' | 'maintenance' | 'blocked';
export type BedType = 'clinical' | 'pediatric' | 'surgical' | 'icu_adult' | 'icu_pediatric';
export type DischargeType = 'discharge' | 'external_transfer' | 'evasion' | 'death' | 'other';
export type Origin = 'spontaneous' | 'samu' | 'transfer' | 'other';
export type MovementType = 'baseline' | 'admission' | 'discharge' | 'transfer_out' | 'transfer_in' | 'cleaning_complete' | 'maintenance_start' | 'maintenance_complete' | 'reserve' | 'reservation_cancel' | 'block' | 'unblock' | 'hospital_confirm';

export interface Hospital {
  id: string;
  name: string;
  shortName: string;
  city: string;
  state: string;
  lastVerifiedAt: string;
}

export interface Block {
  id: string;
  hospitalId: string;
  code: string;
  name: string;
}

export interface Bed {
  id: string;
  hospitalId: string;
  blockId: string;
  code: string;
  type: BedType;
  status: BedStatus;
  currentAdmissionId: string | null;
  statusChangedAt: string;
  revision: number;
}

export interface PatientAddress {
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  postalCode?: string | null;
}

export interface Patient {
  id: string;
  displayName: string;
  socialName: string | null;
  birthDate: string | null;
  unidentified: boolean;
  localRecord: string;
  documentType: string | null;
  documentValue: string | null;
  address: PatientAddress | null;
  contact: string | null;
  guardian: string | null;
  synthetic: boolean;
}

export interface Admission {
  id: string;
  patientId: string;
  hospitalId: string;
  currentBedId: string | null;
  admittedAt: string;
  origin: Origin;
  reason: string;
  procedureCode: string | null;
  procedureDescription: string | null;
  status: 'active' | 'closed';
  dischargedAt?: string;
  dischargeType?: DischargeType;
  destination?: string;
  notes?: string | null;
}

export interface BedAllocation {
  id: string;
  admissionId: string;
  bedId: string;
  startedAt: string;
  endedAt?: string;
}

export interface Reservation {
  id: string;
  bedId: string;
  protocol: string;
  createdAt: string;
  expectedArrivalAt: string;
  responsible: string;
  status: 'active' | 'used' | 'cancelled';
  closedAt?: string;
  cancellationReason?: string;
}

export interface Maintenance {
  id: string;
  bedId: string;
  reason: string;
  responsible: string;
  startedAt: string;
  expectedEndAt: string | null;
  finishedAt?: string;
  completionNote?: string;
  status: 'open' | 'closed';
}

export interface Cleaning {
  id: string;
  bedId: string;
  reason: string;
  startedAt: string;
  finishedAt?: string;
  responsible: string | null;
  completionNote?: string;
  status: 'pending' | 'completed' | 'cancelled';
}

export interface Blockage {
  id: string;
  bedId: string;
  reason: string;
  responsible: string;
  startedAt: string;
  endedAt?: string;
  status: 'open' | 'closed';
}

export interface Movement {
  id: string;
  operationId: string;
  type: MovementType;
  happenedAt: string;
  recordedAt: string;
  hospitalId: string;
  bedId?: string | null;
  admissionId?: string | null;
  patientId?: string | null;
  fromStatus?: BedStatus | null;
  toStatus?: BedStatus | null;
  actor: string;
  reason?: string | null;
  relatedBedId?: string | null;
}

export interface AppState {
  schemaVersion: number;
  revision: number;
  initializedAt: string;
  updatedAt: string;
  hospitals: Hospital[];
  blocks: Block[];
  beds: Bed[];
  patients: Patient[];
  admissions: Admission[];
  allocations: BedAllocation[];
  reservations: Reservation[];
  maintenances: Maintenance[];
  cleanings: Cleaning[];
  blockages: Blockage[];
  movements: Movement[];
}

export const BED_STATUS: Record<BedStatus, { label: string; noun: string; tone: string }> = {
  available: { label: 'Disponível', noun: 'Disponíveis', tone: 'available' },
  occupied: { label: 'Ocupado', noun: 'Ocupados', tone: 'occupied' },
  reserved: { label: 'Reservado', noun: 'Reservados', tone: 'reserved' },
  cleaning: { label: 'Higienização', noun: 'Em higienização', tone: 'cleaning' },
  maintenance: { label: 'Manutenção', noun: 'Em manutenção', tone: 'maintenance' },
  blocked: { label: 'Bloqueado', noun: 'Bloqueados', tone: 'blocked' },
};

export const BED_TYPE: Record<BedType, string> = {
  clinical: 'Clínico',
  pediatric: 'Pediátrico',
  surgical: 'Cirúrgico',
  icu_adult: 'UTI adulto',
  icu_pediatric: 'UTI pediátrica',
};

export const DISCHARGE_TYPE: Record<DischargeType, string> = {
  discharge: 'Alta',
  external_transfer: 'Transferência externa',
  evasion: 'Evasão',
  death: 'Óbito',
  other: 'Outro',
};

export const ORIGIN: Record<Origin, string> = {
  spontaneous: 'Demanda espontânea',
  samu: 'SAMU',
  transfer: 'Transferência',
  other: 'Outro',
};

export type CommandResult<T = undefined> =
  | { ok: true; message: string; value?: T }
  | { ok: false; message: string };


