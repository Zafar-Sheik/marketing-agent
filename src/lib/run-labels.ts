/** Human labels for workflow steps, used by live progress loaders. */
export const RUN_STEPS = {
  'brand-training': [
    { key: 'ingest', label: 'Reading portfolio, website and brief; building brand memory' },
    { key: 'synthesize', label: 'Writing the brand bible' },
  ],
  'monthly-plan': [
    { key: 'research', label: 'Researching trends, competitors and audiences' },
    { key: 'plan', label: 'Writing the strategy and content calendar' },
  ],
  'creative-production': [
    { key: 'concept', label: 'Concept, hook and script' },
    { key: 'frames', label: 'Designing key frames and voice-over' },
    { key: 'clips', label: 'Generating video clips' },
    { key: 'render', label: 'Editing in brand style' },
    { key: 'rendered', label: 'Rendering' },
    { key: 'qa', label: 'Brand review' },
  ],
  'logo-design': [
    { key: 'concepts', label: 'Exploring concepts' },
    { key: 'render', label: 'Drawing logos' },
  ],
  'monthly-report': [
    { key: 'compile', label: 'Analysing the month' },
    { key: 'pdf', label: 'Designing the PDF' },
    { key: 'send', label: 'Sending' },
  ],
} as const;
