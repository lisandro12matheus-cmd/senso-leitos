import template from '../data/seed-template.json';
import type { AppState } from './types';

const APP_STORAGE_KEY = 'leito-vivo:demo:v1';
export const STORAGE_KEY = APP_STORAGE_KEY;
export const DEMO_NOTICE = 'Demonstração • dados fictícios';
export const DEMO_ACTOR = 'Equipe Exemplo — demonstração';
export const HISTORY_START_OFFSET_MINUTES = template.historyCoverageStartOffsetMinutes;

function materialize(value: unknown, anchor: number): unknown {
  if (Array.isArray(value)) return value.map((entry) => materialize(entry, anchor));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith('OffsetMinutes') && typeof child === 'number') {
      output[key.slice(0, -'OffsetMinutes'.length)] = new Date(anchor + child * 60_000).toISOString();
    } else {
      output[key] = materialize(child, anchor);
    }
  }
  return output;
}

export function createDemoState(anchor = Date.now()): AppState {
  const data = materialize(template.state, anchor) as Omit<AppState, 'schemaVersion' | 'revision' | 'initializedAt' | 'updatedAt'> & Record<string, unknown>;
  return {
    ...data,
    schemaVersion: 1,
    revision: 1,
    initializedAt: new Date(anchor).toISOString(),
    updatedAt: new Date(anchor).toISOString(),
  };
}

export function createId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${uuid}`;
}

export function parseStoredState(raw: string): AppState {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O arquivo de demonstração tem um formato inválido.');
  const state = value as Partial<AppState>;
  const required: Array<keyof AppState> = [
    'hospitals', 'blocks', 'beds', 'patients', 'admissions', 'allocations', 'reservations',
    'maintenances', 'cleanings', 'blockages', 'movements',
  ];
  if (state.schemaVersion !== 1) throw new Error('A versão salva dos dados é incompatível. Baixe uma cópia ou restaure a demonstração.');
  if (required.some((key) => !Array.isArray(state[key]))) throw new Error('O arquivo salvo está incompleto. Baixe uma cópia ou restaure a demonstração.');
  return state as AppState;
}


