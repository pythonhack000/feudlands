## Inspiration
Reddit already holds a daily feud in every comment section: cats or dogs, pineapple on pizza, tabs or spaces. People pick a side and argue for it, and the arguments are the best part. We wanted a game where that argument is the weapon, and where the whole subreddit fights over one place, so a single post becomes a war with a front line you can see moving.

## What it does
Feudlands is a daily war over hand-drawn islands. Each day has one feud with two sides. You swear to one, and you and everyone else on the subreddit fight over the same archipelago in the same post.

- **One shared war.** Every move, side and vote lives on the server. Every player replays the same log onto the same seeded islands, so everyone sees the same map, and a camp you place shows up on every screen within seconds.
- **An archipelago, not one island.** A feud is fought over a chain of islands: three to start, and another for every 50 or so fighters who swear in. Each fighter is sent to the island where their side is thinnest, so every island has a fight and every move still counts when the crowd is huge. Islands are linked by fleets: an island your side holds adds 1 to every charge on the islands beside it. The bar at the top shows every island's tug of war, and you can watch any of them.
- **Camps, towers and charges.** Place camps on free hexes. Surround an enemy camp on every side and it turns to yours. Towers can't be boxed in. A charge attacks an enemy hex next to your land: attack is 1, plus your land around it, plus your battle cry. Defence is the piece, plus their land around it, plus 1 for holding the ground.
- **Arguments are the weapons.** The war council is where both sides argue. Every 20 upvotes make an argument 1 stronger as a battle cry, and the best rebuttal from the other side takes its score off. A charge shouts a cry, and the cry gets credit for every hex it takes. Every 25 upvotes a side earns send each of its fighters an extra charge.
- **It teaches you as you go.** New players start with camps only. Surrounding, charges and the council unlock one at a time, with the hexes worth trying drawn dotted on the map.
- **The subreddit picks tomorrow's feud.** The midnight sheet holds a ballot of three feuds, and anyone can suggest their own: a question, two sides and an opening argument for each. The most voted feud goes up as the next day's post with its author's name on it. Nobody can vote for their own.
- **Midnight.** At 00:00 UTC the app pins the result under the post, with the whole day replayed as a GIF: the front moving from morning to midnight. Then it posts tomorrow's feud. In the game, Replay the day plays every move again on the map.
- **Reasons to come back.** Your streak of days at war, the days your side won, and "feud maker" if your feud was picked all go in your subreddit flair. Every seven days a post lists the week's generals over a grid of the week's islands. When a feud comes round again, it's a rematch, with last time's score.
- **Share with the map.** One tap posts your line ("I was the margin: the cats lead by 2 hexes and I took 3") under the feud as your own comment, with the island as it stands.

## How we built it
- **Devvit Web** with a plain JavaScript and canvas client, a Hono server, Redis for the move log, sides, the council, votes, the ballot and records, and the scheduler for midnight.
- **One set of rules for both sides.** The island, captures, charges and the demo crowd's moves live in one shared module. The game draws with it and the server counts with it, so the server's midnight result always matches what players saw.
- **Built to grow.** Each island keeps its own move log and its standing, so a new player downloads one island, not the whole war, and fleets never replay every log.
- **A move log, not a board.** The server stores moves in order and validates them; clients replay the log. The crowd only moves while someone is watching, and the server hands every client the same seed, so the crowd's moves are identical everywhere.
- **Pictures without a canvas.** Devvit's server has no image library, so the server paints the island pixel by pixel and writes the PNG and GIF files itself, with its own LZW encoder.
- **Hand-drawn look.** Every line on the map is a seeded ink wobble with watercolour washes, set in IM Fell, so the island looks like an old map rather than a grid.

## Challenges we ran into
- **Every browser built a different island.** The morning island was sorted with a comparator that rolled dice, and each JavaScript engine compares in a different order. Noise is now drawn once per hex before sorting, and we check that the game in the browser and the server count the same island, hex for hex.
- **Fair numbers.** "5 vs 5" meant nothing to first players. Attack and defence are now spelled out in plain words on the map and in the battle cry sheet, with the breakdown of where each point comes from.
- **Trust.** Players' brags and the cries' power are worked out on the server from the log, so nobody can claim hexes they didn't take. Suggested feuds are cleaned and can't carry links or usernames.

## Accomplishments that we're proud of
- A whole subreddit on one map, with arguments that decide battles.
- The day replayed as a GIF in the thread, drawn by our own encoder on the server.
- A community loop that runs itself: the council picks tomorrow's feud, midnight posts it.

## What we learned
On Reddit, the argument is the game. People will happily fight for a side, and giving their best comment a measurable effect on a map turns a comment thread into a war.

## What's next
- A season map that carries territory over from one feud to the next.
- Banner contests that run across a week.
- Alliances between subreddits on the same feud.
