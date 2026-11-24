// The feuds the subreddit can fight over. Each day the council votes on three of these for tomorrow.
import type { Side } from './rules.ts';

export interface Topic {
  id: string;
  question: string;
  /** Plural names for each side. The game drops a trailing "s" for one fighter. */
  sides: Record<Side, string>;
  /** Optional drawings for the side shields (SVG path data on a 54x64 shield). Otherwise the first letter is used. */
  glyphs?: Record<Side, string>;
  /** The council's opening arguments: [side, text, votes, rebuts index or null, author]. Without an author, the crowd says it. */
  openers: [Side, string, number, number | null, string?][];
  /** Who suggested it, for topics from players. */
  by?: string;
}

export const TOPICS: readonly Topic[] = [
  {
    id: 'cats-dogs', question: 'Cats or dogs?', sides: { a: 'Cats', b: 'Dogs' },
    glyphs: {
      a: 'M17 24l4-9 4 7h4l4-7 4 9c3 9-2 17-10 17s-13-8-10-17z',
      b: 'M16 18c-4 2-4 10 0 12M38 18c4 2 4 10 0 12M18 16c3-3 15-3 18 0 3 8 1 20-9 22-10-2-12-14-9-22z',
    },
    openers: [
      ['a', 'A cat will never make you walk it in the rain at 6 am.', 48, null],
      ['b', 'Nobody has ever been rescued from a fire by a cat.', 44, null],
      ['a', 'Cats invented the internet. Dogs just chew the cables.', 31, null],
      ['b', 'A dog is happy to see you every single time. Every. Time.', 27, null],
      ['a', 'Quiet, clean, and judges your life choices for free.', 12, null],
      ['b', 'Try taking a cat on a hike.', 9, null],
      ['b', 'The walk in the rain is the best part of the day. Ask any dog.', 26, 0],
      ['a', 'Nobody has been rescued from a fire by a goldfish either. Not a job requirement.', 41, 1],
      ['b', 'Dogs invented loyalty. Try running a forum without it.', 8, 2],
      ['a', 'Happy to see you, the mailman, and a sock.', 19, 3],
    ],
  },
  {
    id: 'pineapple', question: 'Pineapple on pizza?', sides: { a: 'Pineapples', b: 'Purists' },
    openers: [
      ['a', 'Sweet and salty is the oldest trick in cooking. Ham agrees.', 39, null],
      ['b', 'Fruit belongs in a bowl, not under mozzarella.', 42, null],
      ['a', 'Tomatoes are a fruit. You lost this argument centuries ago.', 28, null],
      ['b', 'Naples has never once asked for your opinion.', 23, null],
      ['b', 'Then put grapes on it and see how far that logic goes.', 21, 0],
      ['a', 'Naples also gave us pizza for a dollar a slice in New York. Rules bend.', 30, 1],
    ],
  },
  {
    id: 'birds-owls', question: 'Early birds or night owls?', sides: { a: 'Early birds', b: 'Night owls' },
    openers: [
      ['a', 'The world is quiet at 6 am and the coffee is fresh.', 35, null],
      ['b', 'Every good idea in history happened after midnight.', 40, null],
      ['a', 'Sunrises are free. Hangovers are not.', 22, null],
      ['b', 'Nobody has ever said the party really got going at 7 am.', 26, null],
      ['b', 'The world is quiet at 2 am too, and nobody asks you for anything.', 24, 0],
      ['a', 'Name one. You were asleep by the time you remembered it.', 29, 1],
    ],
  },
  {
    id: 'tabs-spaces', question: 'Tabs or spaces?', sides: { a: 'Tabs', b: 'Spaces' },
    openers: [
      ['a', 'One key, one level. Everyone sets the width they like.', 37, null],
      ['b', 'Code should look the same on every screen. Spaces do that.', 41, null],
      ['a', 'Spaces are tabs for people who enjoy pressing keys four times.', 30, null],
      ['b', 'Every style guide you respect says spaces.', 25, null],
      ['b', 'Until someone sets it to 3 and your alignment explodes.', 22, 0],
      ['a', 'Same screen, sure. Same opinion about width, never.', 18, 1],
    ],
  },
  {
    id: 'gif', question: 'GIF: hard G or soft G?', sides: { a: 'Hard Gs', b: 'Soft Gs' },
    openers: [
      ['a', 'Graphics. It stands for graphics. Hard G.', 46, null],
      ['b', 'The man who made it says jif. Case closed.', 43, null],
      ['a', 'Nobody says jraphics.', 33, null],
      ['b', 'Giraffe starts with a G and nobody complains.', 20, null],
      ['b', 'And nobody says jpeg with a soft P either. Acronyms do what they want.', 19, 0],
      ['a', 'The man who made it also made a file format from 1987. Respect, not obedience.', 31, 1],
    ],
  },
  {
    id: 'over-under', question: 'Toilet paper: over or under?', sides: { a: 'Overs', b: 'Unders' },
    openers: [
      ['a', 'The original patent drawing shows it over. History is on our side.', 44, null],
      ['b', 'Under keeps it away from cats and toddlers.', 34, null],
      ['a', 'Over means you can find the end without a search party.', 30, null],
      ['b', 'Under looks tidier. Nobody wants a paper tongue on the wall.', 21, null],
      ['b', 'Patents also show bicycles with one giant wheel.', 23, 0],
      ['a', 'Then get a cat that minds its own business.', 27, 1],
    ],
  },
  {
    id: 'book-film', question: 'The book or the film?', sides: { a: 'Readers', b: 'Watchers' },
    openers: [
      ['a', 'The book had the whole story. The film had two hours.', 41, null],
      ['b', 'Some films beat the book. Nobody finished the book anyway.', 33, null],
      ['a', 'Your imagination has a better budget than any studio.', 29, null],
      ['b', 'A great score and a great actor do things words cannot.', 25, null],
      ['b', 'And six hundred pages of the story were about a lamp.', 22, 0],
      ['a', 'Speak for yourself. Some of us read the ending first, too.', 17, 1],
    ],
  },
  {
    id: 'beach-mountains', question: 'Beach or mountains?', sides: { a: 'Beachgoers', b: 'Climbers' },
    openers: [
      ['a', 'Warm sand, cold drink, no uphill. Undefeated.', 38, null],
      ['b', 'The view from the top is earned. The beach is just there.', 40, null],
      ['a', 'You can swim at the beach. Try swimming up a mountain.', 24, null],
      ['b', 'No sand in places sand should never be.', 31, null],
      ['b', 'No uphill, no story. Nobody tells tales about lying down.', 20, 0],
      ['a', 'Earned it, then walked all the way back down. Great plan.', 26, 1],
    ],
  },
];

export const DEFAULT_TOPIC = TOPICS[0];
export const builtinTopic = (id: string | undefined | null): Topic | undefined => TOPICS.find((t) => t.id === id);
export const topicById = (id: string | undefined | null): Topic => builtinTopic(id) ?? DEFAULT_TOPIC;

/** Limits for a feud a player suggests. */
export const SUGGEST = { questionMin: 8, questionMax: 90, sideMax: 24 } as const;

/** Tomorrow's three choices: the next topics in the list after today's, so the vote rotates through everything. */
export function candidatesAfter(topicId: string, count = 3): Topic[] {
  const at = TOPICS.findIndex((t) => t.id === topicId);
  return Array.from({ length: count }, (_, i) => TOPICS[(Math.max(0, at) + 1 + i) % TOPICS.length]);
}

/** One of a side's fighters, as the game names them. */
export const singular = (plural: string): string => plural.replace(/s$/, '');
