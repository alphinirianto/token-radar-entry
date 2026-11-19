# Token Radar

[![Rank](https://make.fun/badge/token-radar-01/alphinirianto/token-radar-entry/rank.svg)](https://make.fun/c/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/alphinirianto/token-radar-entry/reward.svg)](https://make.fun/c/token-radar-01)
[![make.fun token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)

Entry make.fun untuk token-radar-01. Radar ini memberi peringkat protocol pra-token berdasarkan nilai implisit, dari model peer-valuation sederhana berbasis TVL, pertumbuhan 7 hari, dan lamanya protocol berjalan tanpa token.

## Menjalankan

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Buka `out/dashboard/index.html` di browser untuk melihat papan, detail, dan filter.

## Catatan

Nilai implisit adalah estimasi dari model, bukan harga atau janji. Rencana farm adalah langkah umum yang harus diverifikasi sendiri sebelum dijalankan.
