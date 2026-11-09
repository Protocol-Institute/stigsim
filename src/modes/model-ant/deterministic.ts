import type { AgentObservation, AgentStep, Direction } from '../../../shared/model-ant';
import { checkRightHand } from '../../../shared/model-ant-policy';
import { RIGHT_HAND_POLICY } from '../../../shared/model-ant-config';
export const DETERMINISTIC_MODEL = 'deterministic-right-hand';
export function deterministicStep(observation:AgentObservation,heading:Direction):AgentStep {
 const direction=checkRightHand(observation.neighbors,heading,heading).expectedDirection??heading;
 return {model:DETERMINISTIC_MODEL,decision:{direction,pebbleAction:'none',reason:'',memory:''},events:[{type:'action',text:`Right-hand rule: ${direction} (heading ${heading}).`}],usage:{requests:0,inputTokens:0,outputTokens:0,totalTokens:0},policy:'',policyRevision:0,contextMessages:0,compactions:0,summary:'',elapsedMs:0,suppliedPolicy:RIGHT_HAND_POLICY,policyCheck:checkRightHand(observation.neighbors,heading,direction)};
}
