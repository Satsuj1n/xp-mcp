export interface NotesDeclared {
  declared_total_cents: number | null;
  reference_date: string | null;
}

const RE_CENTS = /patrimonio_total_cents=(\d+)/;
const RE_DATE = /reference_date=(\d{4}-\d{2}-\d{2})/;

export function parseNotesForDeclared(notes: string | null): NotesDeclared {
  if (notes == null || notes === "") {
    return { declared_total_cents: null, reference_date: null };
  }
  const centsMatch = notes.match(RE_CENTS);
  const centsRaw = centsMatch?.[1];
  const dateMatch = notes.match(RE_DATE);
  const dateRaw = dateMatch?.[1];
  return {
    declared_total_cents:
      centsRaw != null ? Number.parseInt(centsRaw, 10) : null,
    reference_date: dateRaw ?? null,
  };
}
