export type Confidence = 'low' | 'medium' | 'high'

export type Category = 'scope' | 'intent' | 'tech' | 'environment' | 'data' | 'style' | 'other'

// open: unmarked. wrong: marked wrong, Claude asked to ask what is right.
// corrected: marked wrong with the right assumption typed in.
// confirmed: marked right; Claude never hears of it.
export type Status = 'open' | 'wrong' | 'corrected' | 'confirmed'

// What a count box at the top narrows the cards to: open ones, open ones of
// low confidence, those marked wrong, those marked right.
export type Filter = 'open' | 'low' | 'marked' | 'confirmed'

export type Card = {
  id: string
  group: string
  statement: string
  why: string
  confidence: Confidence
  category: Category
  source?: string
  impact: string
  status: Status
  correction?: string
}

// One dropdown: the prompt the cards were logged under.
export type Group = { id: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    'assumption-check': {
      // null until capture is first switched: the startOn option stands for it.
      isOn: boolean | null
      groups: Group[]
      cards: Card[]
      expanded: string[]
      selected: string | null
      fixing: string | null
      filter: Filter | null
      // Cards ever logged, so a deleted card's id is never reused.
      cardCount: number
      hasAutoOpened: boolean
    }
  }
}
