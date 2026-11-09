// Set aside for now: features Puhu keeps but does not offer until they are made for him.
// Their pages, settings and pills stay out of sight; the code stays, ready to come back.
export const SHELVED = {
  /** Flow: dictation, the Notetaker, their statistics, dictionary, snippets and styles. */
  flow: true,
  /** « OK Puhu » voice commands. */
  voice: true,
  /**
   * Sorting for classic Outlook, and the chat's Mail switch. Before it comes back: pass
   * values to the PowerShell scripts as data (stdin JSON), not inside the script's text;
   * touch Outlook with what a model wrote only after Run; a plan may attach only files the
   * user dropped, its full path shown on the card.
   */
  mail: true,
  /**
   * WhatsApp in the island (experimental). Before it comes back: pin GOWA's version and
   * its SHA-256 in the code (not taken from the release itself), and start it with a
   * password of its own.
   */
  whatsapp: true,
} as const;
