import type { Field, Paper, Source } from './types.ts';

/** Metadata search shared by the website and HTTP literature discovery. */
export const paperMatches = (paper: Paper, fields: Field[], query: string) => {
  const field = fields.find((item) => item.id === paper.fieldId);
  return `${paper.title} ${paper.authors} ${paper.venue ?? ''} ${paper.year ?? ''} ${field?.name ?? ''} ${field?.shortName ?? ''}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
};

export const sourceMatches = (source: Source, fields: Field[], query: string) => {
  const field = fields.find((item) => item.id === source.fieldId);
  return `${source.title} ${source.authors} ${source.summary} ${source.year ?? ''} ${field?.name ?? ''} ${field?.shortName ?? ''}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
};
