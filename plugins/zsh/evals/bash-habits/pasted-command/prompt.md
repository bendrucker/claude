A teammate sent me this to check where widgetCount is used. Run it exactly as written and show me what it prints:

    grep -rn widgetCount --include=*.ts src; echo ===; grep -c widgetCount src/store.ts
