/** Synthetic browser fixtures; invoked only by scripts/browser-fixture.mjs. */
import {
  readFileSync,
  realpathSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { addDays, addMonths, format } from "date-fns";
import { createUser } from "@/lib/db/users";
import { createAccount } from "@/lib/db/accounts";
import { createRecurringItem } from "@/lib/db/recurring-items";
import { createPlannedItem } from "@/lib/db/planned-items";
import {
  createBudget,
  addBudgetLine,
  addBudgetExpenseEntry,
  setBudgetStatus,
} from "@/lib/db/budgets";
import { createTrip } from "@/lib/db/trips";
import { createGoal } from "@/lib/db/goals";
import { createMortgage } from "@/lib/db/shared-mortgages";
import { createSplitGroup, addExpense } from "@/lib/db/split-groups";
import {
  createBankConnection,
  setConnectionLinkedAccounts,
} from "@/lib/db/bank-connections";
import { writeBankTransactions } from "@/lib/db/bank-transactions";
import { updateUserPreferences } from "@/lib/db/user-preferences";
import { closeDb } from "@/lib/db/sqlite/client";
import type { BankTransaction } from "@/types";

function assertThrowawayRoot() {
  const dataDir = process.env.DATA_DIR;
  const token = process.env.SAMPOLIO_SYNTHETIC_TOKEN;
  if (
    !dataDir ||
    !token ||
    !lstatSync(dataDir).isDirectory() ||
    lstatSync(dataDir).isSymbolicLink()
  )
    throw new Error("Synthetic runner context required");
  const canonical = realpathSync(dataDir);
  if (
    dirname(canonical) !== realpathSync(tmpdir()) ||
    !/^sampolio-browser-[A-Za-z0-9]+$/.test(basename(canonical))
  )
    throw new Error("Fixture DATA_DIR must be a runner-created temporary root");
  if (readFileSync(join(canonical, ".synthetic-fixture"), "utf8") !== token)
    throw new Error("Synthetic runner marker mismatch");
  if (
    resolve(dataDir) !==
    resolve(process.env.SAMPOLIO_SYNTHETIC_FIXTURE_DIR ?? "")
  )
    throw new Error("Fixture root mismatch");
}

async function seed() {
  assertThrowawayRoot();
  const now = new Date();
  const timestamp = now.toISOString();
  const month = format(now, "yyyy-MM");
  const start = format(addMonths(now, -2), "yyyy-MM");
  const end = format(addMonths(now, 6), "yyyy-MM");
  const today = format(now, "yyyy-MM-dd");
  // Existing DB function hashes passwords through Better Auth and creates the
  // real SQLCipher credential/user records. No fabricated auth rows or sessions.
  const alex = await createUser(
    "alex@example.com",
    "Synthetic-Only-2026!",
    "Alex",
  );
  const sam = await createUser(
    "sam@example.com",
    "Synthetic-Only-2026!",
    "Sam",
  );
  // Additional synthetic accounts make all admin pagination sizes meaningful.
  for (let index = 1; index <= 10; index++) {
    await createUser(
      `sam${index}@example.com`,
      "Synthetic-Only-2026!",
      `Sam ${String(index).padStart(2, "0")}`,
    );
  }
  const account = await createAccount(alex.id, {
    name: "Everyday account",
    currency: "EUR",
    startingBalance: 2400,
    startingDate: start,
    planningHorizonMonths: 24,
  });
  await createRecurringItem(alex.id, {
    accountId: account.id,
    name: "Synthetic salary",
    type: "income",
    amount: 3000,
    frequency: "monthly",
    startDate: start,
    category: "Salary",
  });
  await createRecurringItem(alex.id, {
    accountId: account.id,
    name: "Synthetic rent",
    type: "expense",
    amount: 950.5,
    frequency: "monthly",
    startDate: start,
    category: "Housing",
  });
  await createPlannedItem(alex.id, {
    accountId: account.id,
    name: "Synthetic bike repair",
    type: "expense",
    kind: "one-off",
    amount: 180,
    scheduledDate: month,
    category: "Transport",
  });
  const budget = await createBudget(alex.id, {
    name: "Synthetic workshop",
    currency: "EUR",
    destination: "Example city",
    startMonth: month,
    endMonth: end,
    linkedAccountId: account.id,
  });
  await addBudgetLine(alex.id, budget.id, {
    name: "Materials",
    category: "Other",
    amount: 300,
    kind: "one-off",
    month,
  });
  await addBudgetExpenseEntry(alex.id, budget.id, {
    description: "Synthetic materials",
    category: "Other",
    amount: 42.5,
    date: today,
  });
  await setBudgetStatus(alex.id, budget.id, "confirmed");
  const trip = await createTrip(alex.id, {
    name: "Synthetic training trip",
    destinationCountry: "FI",
    startDateTime: `${today}T08:00`,
    endDateTime: `${format(addDays(now, 2), "yyyy-MM-dd")}T17:00`,
    days: [0, 1, 2].map((index) => ({
      date: format(addDays(now, index), "yyyy-MM-dd"),
      countryCode: "FI",
      freeMeals: 0,
    })),
    rates: {
      domesticFull: 54,
      domesticPartial: 25,
      defaultForeign: 65,
      countryRates: {},
    },
    linkedAccountId: account.id,
    expectedReimbursementMonth: month,
    status: "planned",
  });
  await createGoal(alex.id, {
    name: "Synthetic reserve",
    currency: "EUR",
    targetAmount: 5000,
    trackingMethod: "manual",
    currentManualAmount: 1000,
    targetDate: end,
  });
  const creator = { userId: alex.id, email: alex.email, name: alex.name };
  const mortgage = await createMortgage(
    creator,
    {
      name: "Synthetic home",
      currency: "EUR",
      housePrice: 180000,
      creatorInitialPayment: 10000,
      creatorLoanSharePercent: 0.5,
      creatorOwnershipTargetPercent: 0.5,
      loans: [
        {
          label: "Example loan",
          kind: "regular",
          initialPrincipal: 160000,
          startDate: start,
          originalTermMonths: 240,
          margin: 0.6,
        },
      ],
      rates: [{ effectiveDate: start, euriborRate: 2.3 }],
    },
    [
      {
        userId: sam.id,
        email: sam.email,
        name: sam.name,
        role: "member",
        initialPayment: 10000,
        loanSharePercent: 0.5,
        ownershipTargetPercent: 0.5,
      },
    ],
  );
  const group = await createSplitGroup(
    creator,
    { name: "Synthetic household", emoji: "🏠", currency: "EUR" },
    [{ userId: sam.id, email: sam.email, name: sam.name, role: "member" }],
  );
  const connection = await createBankConnection(alex.id, {
    aspspName: "Synthetic Bank",
    aspspCountry: "FI",
    status: "active",
  });
  const linkedAccountId = uuidv4();
  const creditCardAccountId = uuidv4();
  await setConnectionLinkedAccounts(alex.id, connection.id, [
    {
      id: linkedAccountId,
      connectionId: connection.id,
      accountUid: "synthetic-only-no-session",
      name: "Synthetic current account",
      currency: "EUR",
      accountRole: "cash",
      linkedFinancialAccountId: account.id,
      lastBalance: 2400,
      lastSyncedAt: timestamp,
    },
    ...["Synthetic savings account", "Synthetic holiday account", "Synthetic long household reserve account"].map((name, index) => ({
      id: uuidv4(),
      connectionId: connection.id,
      accountUid: `synthetic-extra-${index}`,
      name,
      currency: "EUR" as const,
      accountRole: "cash" as const,
      lastBalance: 300 + index * 100,
      lastSyncedAt: timestamp,
    })),
    {
      id: creditCardAccountId,
      connectionId: connection.id,
      accountUid: "synthetic-only-credit-card",
      name: "Synthetic credit card",
      currency: "EUR",
      accountRole: "credit-card",
      lastBalance: -54.65,
      lastSyncedAt: timestamp,
    },
  ]);
  await createBankConnection(alex.id, {
    aspspName: "Synthetic Second Bank",
    aspspCountry: "FI",
    status: "active",
  });
  const transactions: BankTransaction[] = Array.from(
    { length: 125 },
    (_, index) => ({
      id: uuidv4(),
      linkedAccountId,
      dedupKey: `synthetic-${index}`,
      bookingDate: format(
        index >= 122
          ? addMonths(now, -(index - 120))
          : addDays(now, -Math.floor(index / 4)),
        "yyyy-MM-dd",
      ),
      amount: index === 1 ? -50 : -(10 + index / 10),
      currency: "EUR",
      status: index === 0 ? "pending" : "booked",
      counterpartyName:
        index === 0
          ? "Synthetic pending shop"
          : index === 1
            ? "Synthetic linked groceries"
            : `Synthetic purchase ${index}`,
      remittanceInfo: "Synthetic browser fixture",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    }),
  );
  await writeBankTransactions(alex.id, linkedAccountId, transactions);
  const pendingCardTransactions = {
    desktop: {
      id: uuidv4(),
      title: "Synthetic pending card lunch desktop",
      amount: -23.45,
    },
    mobile: {
      id: uuidv4(),
      title: "Synthetic pending card lunch mobile",
      amount: -31.2,
    },
  };
  await writeBankTransactions(
    alex.id,
    creditCardAccountId,
    Object.values(pendingCardTransactions).map((transaction) => ({
      id: transaction.id,
      linkedAccountId: creditCardAccountId,
      dedupKey: `synthetic-${transaction.id}`,
      bookingDate: today,
      amount: transaction.amount,
      currency: "EUR",
      status: "pending",
      counterpartyName: transaction.title,
      remittanceInfo: "Synthetic pending credit-card purchase",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    })),
  );
  const expenseId = uuidv4();
  await addExpense(group.id, {
    id: expenseId,
    groupId: group.id,
    kind: "expense",
    date: transactions[1].bookingDate,
    title: "Synthetic linked groceries",
    category: "Groceries",
    currency: "EUR",
    amountCents: 5000,
    paidBy: [{ userId: alex.id, amountCents: 5000 }],
    owed: [
      { userId: alex.id, amountCents: 2500 },
      { userId: sam.id, amountCents: 2500 },
    ],
    netByUserId: { [alex.id]: 2500, [sam.id]: -2500 },
    source: "manual",
    createdByUserId: alex.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    bankLink: {
      txId: transactions[1].id,
      linkedAccountId,
      ownerUserId: alex.id,
      bookingDate: transactions[1].bookingDate,
      amount: -50,
      currency: "EUR",
      counterpartyName: transactions[1].counterpartyName,
      bankName: "Synthetic Bank",
    },
  });
  await updateUserPreferences(alex.id, {
    hasCompletedOnboarding: true,
    displayMode: "advanced",
    defaultSplitGroupId: group.id,
    checkInRemindersEnabled: false,
  });
  await updateUserPreferences(sam.id, { hasCompletedOnboarding: true });
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/synthetic.json",
    JSON.stringify({
      accountId: account.id,
      budgetId: budget.id,
      tripId: trip.id,
      mortgageId: mortgage.id,
      groupId: group.id,
      linkedAccountId,
      creditCardAccountId,
      linkedTransactionId: transactions[1].id,
      pendingCardTransactions,
      deepTransactionId: transactions[124].id,
      expenseId,
    }),
  );
  console.log(
    "[synthetic] seeded Alex/Sam, cashflow, budget, trip, goal, mortgage, split and125 bank transactions",
  );
}
seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
