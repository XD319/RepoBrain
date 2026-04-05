import type { InvocationPlan, InvocationPlanSlot, ResolvedSkill } from "./skill-routing-types.js";

/**
 * Output contract layer: maps resolved per-skill decisions into the stable invocation_plan shape.
 */
export function buildInvocationPlan(resolvedSkills: ResolvedSkill[]): InvocationPlan {
  const plan: InvocationPlan = {
    required: [],
    prefer_first: [],
    optional_fallback: [],
    suppress: [],
    blocked: [],
    human_review: [],
  };

  for (const skill of resolvedSkills) {
    switch (skill.plan_slot) {
      case "required":
        plan.required.push(skill.skill);
        break;
      case "prefer_first":
        plan.prefer_first.push(skill.skill);
        break;
      case "optional_fallback":
        plan.optional_fallback.push(skill.skill);
        break;
      case "suppress":
        plan.suppress.push(skill.skill);
        break;
      case "blocked":
        plan.blocked.push(skill.skill);
        break;
      case "human_review":
        plan.human_review.push(skill.skill);
        break;
      case "none":
        break;
    }
  }

  return plan;
}

export function invocationPlanSlotOrder(slot: InvocationPlanSlot | "none"): number {
  const order: Record<InvocationPlanSlot | "none", number> = {
    required: 0,
    blocked: 1,
    human_review: 2,
    prefer_first: 3,
    optional_fallback: 4,
    suppress: 5,
    none: 6,
  };
  return order[slot];
}
