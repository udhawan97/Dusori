/** Export shapes offered for a single topic. `zip` is the existing portable bundle. */
export type TopicExportFormat = 'zip' | 'markdown' | 'text' | 'json' | 'html' | 'pdf';

export const topicExportFormats: { id: TopicExportFormat; label: string; detail: string }[] = [
  { id: 'zip', label: 'ZIP bundle', detail: 'Every original Markdown and JSON file.' },
  { id: 'markdown', label: 'Markdown', detail: 'Notes, roadmap, and synthesis in one .md.' },
  { id: 'html', label: 'HTML', detail: 'A styled, self-contained web page.' },
  { id: 'pdf', label: 'PDF', detail: 'Opens the print dialog — choose Save as PDF.' },
  { id: 'json', label: 'JSON', detail: 'Structured data for reuse elsewhere.' },
  { id: 'text', label: 'Plain text', detail: 'Notes without Markdown syntax.' },
];
