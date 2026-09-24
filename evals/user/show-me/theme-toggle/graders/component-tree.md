---
type: regex
pattern: '^```[^\n]*\n(?:(?!```)[\s\S])*?ThemeProvider(?:(?!```)[\s\S])*?^[ │├└─]{2,}<?(?:TopBar|Sidebar)'
flags: m
match: contains
---
The wiring appears as a component tree from the provider down to the top bar or sidebar.
