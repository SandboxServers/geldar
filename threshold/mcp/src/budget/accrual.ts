/**
 * Credit accrual and the reserve rule (spec 5.7, 5.15.3). The rules live beside the Postgres
 * ledger that uses them, in `store/pg-budget.ts`, so the SQL and the pure functions cannot drift.
 * This module is the budget's entry point for the tools: they import accrual from here.
 */
export {
  type AccrualRules,
  accrue,
  type BudgetState,
  takeCredits,
} from '../store/pg-budget.ts';
