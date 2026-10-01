/** An editorial example, never inserted into the research database. */
export type EditReason = 'filler' | 'inference' | 'limits';
export const editReasons: { id: EditReason; title: string; note: string }[] = [
  {
    id: 'filler',
    title: 'Remove the preamble',
    note: 'Start with the finding. Praise and repeated framing add no evidence.',
  },
  {
    id: 'inference',
    title: 'Check the inference',
    note: 'A shared naming scheme does not establish that experimental conditions match.',
  },
  {
    id: 'limits',
    title: 'Keep the boundary',
    note: 'Say which source was read and which work was not done.',
  },
];
export const revisionExample = {
  title: 'Comparing battery cycling studies',
  source: {
    title: 'Battery Archive · metadata conventions',
    url: 'https://batteryarchive.org/metadata.html',
    locator: 'Cycling conditions and §6, Min–Max SOC',
  },
  draft: [
    {
      text: 'In the rapidly evolving landscape of battery research, it is important to take a comprehensive and nuanced approach to the question of how different studies can be meaningfully compared. ',
      reason: 'filler',
    },
    {
      text: 'Battery Archive provides a useful naming scheme with information about chemistry, temperature, state of charge and cycling rates. ',
    },
    {
      text: 'Matching these labels should therefore make studies directly comparable. ',
      reason: 'inference',
    },
    {
      text: 'However, it is worth noting that routine cycling and capacity checks may use different conditions, and state of charge can be defined using either capacity or voltage. ',
    },
    {
      text: 'These considerations highlight the importance of a thoughtful and robust approach to future analysis. ',
      reason: 'filler',
    },
    {
      text: 'This discussion is based on the archive documentation; the underlying datasets have not been reanalysed.',
      reason: 'limits',
    },
  ] as { text: string; reason?: EditReason }[],
  edited: [
    {
      text: 'Matching Cell ID labels alone does not establish a fair comparison. ',
      reason: 'inference',
    },
    {
      text: 'They encode chemistry, temperature, SOC and routine cycling rates; capacity checks may use other conditions. SOC ranges may use capacity or voltage as their basis. Before pooling studies, check those definitions in each study’s documentation. ',
    },
    {
      text: 'This is a source audit of Battery Archive’s metadata conventions. No datasets were reanalysed.',
      reason: 'limits',
    },
  ] as { text: string; reason?: EditReason }[],
};
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
export const wordCount = (text: string) => text.trim().split(/\s+/).length;
