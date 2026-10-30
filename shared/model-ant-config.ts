import type { Direction } from './model-ant';
import { EXPLORATION_POLICY } from './model-ant-policy';
export type Strategy = 'none' | 'exploration-v1' | 'right-hand' | 'custom';
export interface ExperimentConfig { model: string; mode: 'selection' | 'agent'; seed: string; loopRate: number; observationSupport: 'raw-history' | 'observed-map'; strategy: Strategy; customPolicy: string; initialHeading: Direction }
export const RIGHT_HAND_POLICY = 'Follow the right-hand wall rule relative to your current heading: choose the first passable direction in this order: right, straight, left, reverse. After a successful move, heading becomes its direction. A blocked move leaves heading unchanged. Pebble use is up to you.';
export function strategyText(strategy: Strategy, custom = '') { return strategy === 'exploration-v1' ? EXPLORATION_POLICY : strategy === 'right-hand' ? RIGHT_HAND_POLICY : strategy === 'custom' ? custom : ''; }
export function validStrategy(value: unknown): value is Strategy { return ['none','exploration-v1','right-hand','custom'].includes(value as string); }
