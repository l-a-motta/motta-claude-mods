export type Confidence = 'low' | 'medium' | 'high'

export type Category = 'scope' | 'intent' | 'tech' | 'environment' | 'data' | 'style' | 'other'

// open: unmarked. wrong: marked wrong, Claude asked to ask what is right.
// corrected: marked wrong with the right assumption typed in.
export type Status = 'open' | 'wrong' | 'corrected'

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
      isOn: boolean
      groups: Group[]
      cards: Card[]
      expanded: string[]
      selected: string | null
      fixing: string | null
      // Cards ever logged, so a deleted card's id is never reused.
      cardCount: number
      hasAutoOpened: boolean
    }
  }
}
