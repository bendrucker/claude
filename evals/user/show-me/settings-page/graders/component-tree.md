---
type: regex
pattern: '^```[^\n]*\n(?:(?!```)[\s\S])*?SettingsPage[^\n]*\n(?:(?!```)[\s\S])*?^[ │├└─]{2,}<?ProfileForm(?:(?!```)[\s\S])*?^[ │├└─]{4,}<?(?:AvatarPicker|TextField)'
flags: m
match: contains
---
The page appears as a component tree nested to the form fields.
