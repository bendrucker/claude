# jobq

Drains the retry queue: loads every pending job, then runs them in order. `make` builds `build/jobq`, and running it with no arguments drains a 50,000-job backlog.
