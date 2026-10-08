/** Current company assignment, never the orderer's user id. Copies keep assignments in company_sales_reps. */
export function companyRepSql(companyAlias: string, copies = false): string {
  return copies
    ? `(SELECT sr.assigned_sales_user_id FROM company_sales_reps sr WHERE sr.id = ${companyAlias}.id)`
    : `${companyAlias}.assigned_sales_user_id`;
}

/** undefined = team; [] = empty own scope. Every scoped call binds the array, including an empty one. */
export function repScopeSql(companyAlias: string, parameter: string, copies = false): string {
  return `${companyRepSql(companyAlias, copies)} = ANY(${parameter}::uuid[])`;
}
