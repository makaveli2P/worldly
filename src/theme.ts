// Light "printed atlas" palette. styles.css mirrors these as CSS custom properties.
export const theme = {
  background: '#F4F2EC', // paper
  ocean: '#E3E7EA',
  land: '#D5D2C8',
  landSide: '#BDB9AD', // extruded walls of a raised country
  border: '#F4F2EC', // country borders read as thin paper gaps
  hover: '#C9C4B5',
  accent: '#B4532A', // one accent: the selected country and active states
  ink: '#1C1C1A',
  muted: '#6B6A64',
} as const;
