/**
 * The world volume the Paper server writes to. Compose names it `<project>_paper-data`; GELDAR_WORLD_VOLUME selects
 * another volume (compose/phase0.yml). The default is the volume the existing runs used.
 */
export const COMPOSE_PROJECT = 'geldar-phase0';
export const DEFAULT_WORLD_VOLUME = `${COMPOSE_PROJECT}_paper-data`;
