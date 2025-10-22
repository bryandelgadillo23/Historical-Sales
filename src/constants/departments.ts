export type Department = "Equipment" | "Rental" | "Parts" | "Service";

export const DEPT_MAP: Record<Department, string[]> = {
  Equipment: [
    "New Equipment Sales",
    "Used Equipment Sales",
    "RPO Sales",
    "Re-Marketing Sales",
    "Trade-In Sales",
    "RtoR Sales",
    "Other",
    "Total Equipment",
  ],
  Rental: [
    "RF Revenue",
    "RPO Revenue",
    "Re-Rent Revenue",
    "Loaner Revenue",
    "Loaner Internal",
    "Used Rental",
    "Total Rental",
  ],
  Parts: [
    "Parts Counter",
    "Parts Shop",
    "Parts Warranty",
    "Warranty Settlement",
    "Warranty Settlement - Adj",
    "Parts Internal",
    "Parts Internal - CSA Cust",
    "Parts Internal - CSA Rental",
    "Parts Internal - ACAP",
    "Parts Internal - EM",
    "Total Parts",
  ],
  Service: [
    "Customer",
    "Warranty",
    "Internal",
    "Sublet",
    "Total Service",
  ],
};

export const ALL_DEPARTMENTS = Object.keys(DEPT_MAP) as Department[];

export function flattenAllMetrics(): string[] {
  return ALL_DEPARTMENTS.flatMap((d) => DEPT_MAP[d]);
}

export function metricsForDepartment(d: Department): string[] {
  return DEPT_MAP[d];
}

export function departmentForMetric(metric: string): Department | null {
  const entry = (Object.entries(DEPT_MAP) as [Department, string[]][]).find(([_, metrics]) =>
    metrics.includes(metric)
  );
  return entry ? entry[0] : null;
}
