/**
 * The subset of the Google Chat `Message` resource we send. Cards v2 reference:
 * https://developers.google.com/workspace/chat/api/reference/rest/v1/cards
 */
export interface ChatMessage {
  text?: string;
  cardsV2?: { cardId: string; card: Card }[];
  thread?: { threadKey: string };
}

export interface Card {
  header?: { title: string; subtitle?: string };
  sections: CardSection[];
}

export interface CardSection {
  header?: string;
  collapsible?: boolean;
  uncollapsibleWidgetsCount?: number;
  widgets: Widget[];
}

export type Widget =
  | { textParagraph: { text: string } }
  | { decoratedText: { topLabel?: string; text: string; wrapText?: boolean } }
  | { buttonList: { buttons: { text: string; onClick: { openLink: { url: string } } }[] } }
  | { divider: Record<string, never> };

/**
 * What a renderer hands to a destination: the rich card plus a plain-text fallback the destination can send
 * if Chat rejects the card (e.g. a Workspace that restricts cards, or a malformed widget).
 */
export interface OutboundMessage {
  card: ChatMessage;
  fallback: ChatMessage;
  threadKey?: string;
}
