import {
  resolveShotProductionPlan as resolveDomainShotProductionPlan,
  type ShotProductionIntent as DomainShotProductionIntent,
} from "../../packages/domain/src/production";
import type { WorkflowCapability } from "./workflow-capabilities";
import { bindingCapabilityKey } from "./workflow-capabilities";
import { resolveRoutingTargetCapability, type ProductionRoutingRule, type ShotRoutingIntent } from "./production-routing-rules";

export type ShotProductionIntent = {
  characterCount: number;
  hasDialogue: boolean;
  hasVoiceReference: boolean;
  hasFirstFrame: boolean;
  hasLastFrame: boolean;
  needsIdentityReplacement?: boolean;
  videoCapability?: WorkflowCapability;
};

export type ResolvedShotProductionPlan = {
  strategy: string;
  capabilities: WorkflowCapability[];
  parallelGroups: WorkflowCapability[][];
  explanation: string;
  videoCapability: WorkflowCapability;
};

function toDomainIntent(intent: ShotProductionIntent): DomainShotProductionIntent {
  return {
    characterCount: intent.characterCount,
    hasDialogue: intent.hasDialogue,
    hasVoiceReference: intent.hasVoiceReference,
    hasFirstFrame: intent.hasFirstFrame,
    hasLastFrame: intent.hasLastFrame,
    needsIdentityReplacement: intent.needsIdentityReplacement,
    videoCapability: intent.videoCapability as DomainShotProductionIntent["videoCapability"],
  };
}

function toWorkflowCapabilities(values: string[]): WorkflowCapability[] {
  return values as WorkflowCapability[];
}

export function resolveShotProductionPlan(
  intent: ShotProductionIntent,
  configured: ReadonlySet<string>,
  rules?: readonly ProductionRoutingRule[],
): ResolvedShotProductionPlan {
  const routingIntent = intent as ShotRoutingIntent;
  const videoCapability = intent.videoCapability && configured.has(bindingCapabilityKey(intent.videoCapability))
    ? intent.videoCapability
    : resolveRoutingTargetCapability(routingIntent, configured, rules);
  const domainPlan = resolveDomainShotProductionPlan({ ...toDomainIntent(intent), videoCapability: videoCapability as DomainShotProductionIntent["videoCapability"] }, configured as ReadonlySet<never>);
  return {
    strategy: domainPlan.strategy,
    capabilities: toWorkflowCapabilities(domainPlan.capabilities),
    parallelGroups: domainPlan.parallelGroups.map((group) => toWorkflowCapabilities(group)),
    explanation: domainPlan.explanation,
    videoCapability,
  };
}

export function parseShotProductionIntent(value: string, overrides: Partial<ShotProductionIntent> = {}): ShotProductionIntent {
  let source: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      source = record.intent && typeof record.intent === "object" && !Array.isArray(record.intent)
        ? record.intent as Record<string, unknown>
        : record;
    }
  } catch {
    source = {};
  }
  return {
    characterCount: typeof overrides.characterCount === "number" ? overrides.characterCount : typeof source.characterCount === "number" ? source.characterCount : 0,
    hasDialogue: typeof overrides.hasDialogue === "boolean" ? overrides.hasDialogue : source.hasDialogue === true,
    hasVoiceReference: typeof overrides.hasVoiceReference === "boolean" ? overrides.hasVoiceReference : source.hasVoiceReference === true,
    hasFirstFrame: typeof overrides.hasFirstFrame === "boolean" ? overrides.hasFirstFrame : source.hasFirstFrame === true,
    hasLastFrame: typeof overrides.hasLastFrame === "boolean" ? overrides.hasLastFrame : source.hasLastFrame === true,
    needsIdentityReplacement: typeof overrides.needsIdentityReplacement === "boolean" ? overrides.needsIdentityReplacement : source.needsIdentityReplacement === true,
    videoCapability: typeof overrides.videoCapability === "string"
      ? overrides.videoCapability
      : typeof source.videoCapability === "string"
        ? source.videoCapability as WorkflowCapability
        : undefined,
  };
}

export { resolveDomainShotProductionPlan };
