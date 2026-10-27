import { v4 as uuidv4 } from 'uuid';
import type {
  Goal,
  CreateGoalRequest,
  UpdateGoalRequest,
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { goal as goalTable } from './sqlite/schema';

const goalKey = (userId: string, goalId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  id: assertSafeId(goalId),
});

// ============================================================
// GOALS CRUD
// ============================================================

export async function getGoals(userId: string): Promise<Goal[]> {
  const goals = listDocs<Goal>(goalTable, { userId: assertSafeId(userId, 'userId') });

  return goals.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getGoalById(userId: string, goalId: string): Promise<Goal | null> {
  return getDoc<Goal>(goalTable, goalKey(userId, goalId));
}

export async function createGoal(userId: string, data: CreateGoalRequest): Promise<Goal> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const goal: Goal = {
    id,
    userId,
    name: data.name,
    description: data.description,
    targetAmount: data.targetAmount,
    currency: data.currency,
    targetDate: data.targetDate,
    trackingMethod: data.trackingMethod,
    linkedAccountId: data.linkedAccountId,
    currentManualAmount: data.currentManualAmount,
    goalType: data.goalType,
    priority: data.priority,
    injectIntoCashflow: data.injectIntoCashflow,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(goalTable, goalKey(userId, id), goal);

  return goal;
}

export async function updateGoal(
  userId: string,
  goalId: string,
  updates: UpdateGoalRequest
): Promise<Goal | null> {
  return inTx(() => {
    const goal = getDoc<Goal>(goalTable, goalKey(userId, goalId));
    if (!goal) {
      return null;
    }

    const updatedGoal: Goal = {
      ...goal,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    putDoc(goalTable, goalKey(userId, goalId), updatedGoal);
    return updatedGoal;
  });
}

export async function deleteGoal(userId: string, goalId: string): Promise<boolean> {
  deleteRows(goalTable, goalKey(userId, goalId));
  return true;
}
