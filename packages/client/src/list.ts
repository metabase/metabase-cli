// The whole result of a list endpoint that answers in one response, as against `Page<T>` in
// `./paginate` — the same two fields, but one page of a walk still in progress. A method's return
// type is how a caller tells which of the two it is holding.
export interface ListResult<T> {
  data: T[];
  total: number | null;
}
