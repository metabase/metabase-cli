import { z } from "zod";

export const DATA_TEST_TYPES = ["transform", "card", "segment"] as const;
export const DataTestType = z.enum(DATA_TEST_TYPES);
export type DataTestType = z.infer<typeof DataTestType>;

export function isDataTestCode(value: string): boolean {
  return DATA_TEST_TYPES.some((type) => value.startsWith(`${type}-test.`));
}

export const DataTestRunStatus = z.enum(["started", "passed", "failed", "error", "timeout"]);
export type DataTestRunStatus = z.infer<typeof DataTestRunStatus>;

const DataTestRunUser = z
  .object({
    id: z.number().int(),
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  })
  .loose();

export const DataTestRun = z
  .object({
    id: z.number().int(),
    test_type: DataTestType,
    test_id: z.number().int().nullable(),
    initiated_by: z.number().int().nullable(),
    initiated_by_user: DataTestRunUser.nullable(),
    start_time: z.string(),
    end_time: z.string().nullable(),
    status: DataTestRunStatus,
    last_heartbeat: z.string(),
  })
  .loose();
export type DataTestRun = z.infer<typeof DataTestRun>;

export const DataTestRunCompact = DataTestRun.pick({
  id: true,
  test_type: true,
  test_id: true,
  initiated_by: true,
  start_time: true,
  end_time: true,
  status: true,
}).strip();
export type DataTestRunCompact = z.infer<typeof DataTestRunCompact>;
