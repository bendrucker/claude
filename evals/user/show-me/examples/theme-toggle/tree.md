---
fail: []
---
```tsx fragment
<ThemeProvider>            dark state + toggle in ThemeContext
  <Shell>
    <TopBar>               useContext(ThemeContext) → header class
      <DarkModeSwitch>     calls toggle()
    <Sidebar>              useContext(ThemeContext) → aside class
```
