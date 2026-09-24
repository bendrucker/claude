Reproduced: `bun run list 3 9` prints Lior (id 9) again as the first row of page 2.

The cause is `src/users.ts:17`, which filters with `u.id >= cursor`. `next` is the id of the last item already shown, so the inclusive comparison re-includes it. Switching the filter to `u.id > cursor` makes page 2 start at Mei.
