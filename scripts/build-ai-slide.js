const pptxgen = require('pptxgenjs')

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.3 x 7.5

// The exhibit's own palette: a night sky, the teal of its satellite light and
// the amber of its aircraft light.
const BG = '0E1A2B'
const CARD = '18273C'
const TEAL = '55CDDF'
const AMBER = 'EDA45B'
const WHITE = 'FFFFFF'
const BODY = 'C3D2E0'
const MUTED = '8598AA'
const KO = 'Malgun Gothic'

const slide = pres.addSlide()
slide.background = { color: BG }

// ── Header ────────────────────────────────────────────────────────────────
slide.addText('기술개발 · 과학관 돔 전시 프로그램 (Aviation Route)', {
  x: 0.6, y: 0.42, w: 9.0, h: 0.28, margin: 0,
  fontFace: KO, fontSize: 12, color: TEAL, charSpacing: 1
})

slide.addText('AI를 어떻게 썼나 — 시키기 전에 설계를 글로 썼습니다', {
  x: 0.6, y: 0.74, w: 12.1, h: 0.62, margin: 0,
  fontFace: KO, fontSize: 32, bold: true, color: WHITE
})

slide.addText(
  '기능 하나마다 Markdown 계획서를 먼저 쓰고, 그 문서를 기준으로 구현하고, 실제 로그로 확인한 뒤에야 완료로 넘겼습니다. 네 단계를 4주 동안 반복했습니다.',
  {
    x: 0.6, y: 1.44, w: 12.1, h: 0.5, margin: 0,
    fontFace: KO, fontSize: 13.5, color: BODY, lineSpacingMultiple: 1.25
  }
)

// ── Four steps ────────────────────────────────────────────────────────────
const STEPS = [
  {
    no: '01',
    title: '계획을 글로',
    body:
      'Markdown 계획서를 먼저 씁니다. 무엇을 · 왜 · 어떻게 검증할지까지. ' +
      'README에는 구조와 규칙을 고정해 두어, 대화가 길어져도 기준이 흔들리지 않게 했습니다.'
  },
  {
    no: '02',
    title: 'AI가 구현',
    body:
      '그 문서를 기준으로 코드를 씁니다. 무엇을 했는지가 아니라 ' +
      '왜 그렇게 했는지를 주석으로 남겨, 코드 자체가 설명서가 되게 했습니다.'
  },
  {
    no: '03',
    title: '실측으로 검증',
    body:
      '추측 금지. 전시 PC의 실제 기록과 헤드리스 브라우저 테스트로 ' +
      '눈으로 확인한 뒤에만 "됐다"고 말합니다. 안 되면 원인을 찾을 때까지 되돌아갑니다.'
  },
  {
    no: '04',
    title: '문서로 마무리',
    body:
      '인수인계 노트도 같은 원본에서 웹용 · 워드용으로 자동 생성합니다. ' +
      '코드를 고치면 문서도 같이 고치는 것이 마지막 단계입니다.'
  }
]

const CARD_Y = 2.15
const CARD_H = 2.5
const CARD_W = 2.8
STEPS.forEach((s, i) => {
  const x = 0.6 + i * (CARD_W + 0.3)
  slide.addShape(pres.ShapeType.roundRect, {
    x, y: CARD_Y, w: CARD_W, h: CARD_H,
    rectRadius: 0.1,
    fill: { color: CARD },
    line: { color: '24374F', width: 1 }
  })
  // The repeated motif: a numbered teal disc on every card.
  slide.addShape(pres.ShapeType.ellipse, {
    x: x + 0.24, y: CARD_Y + 0.24, w: 0.46, h: 0.46,
    fill: { color: TEAL },
    line: { color: TEAL, width: 1 }
  })
  slide.addText(s.no, {
    x: x + 0.24, y: CARD_Y + 0.24, w: 0.46, h: 0.46, margin: 0,
    fontFace: KO, fontSize: 13, bold: true, color: BG,
    align: 'center', valign: 'middle'
  })
  slide.addText(s.title, {
    x: x + 0.8, y: CARD_Y + 0.26, w: CARD_W - 1.0, h: 0.42, margin: 0,
    fontFace: KO, fontSize: 16, bold: true, color: WHITE, valign: 'middle'
  })
  slide.addText(s.body, {
    x: x + 0.24, y: CARD_Y + 0.86, w: CARD_W - 0.48, h: CARD_H - 1.1, margin: 0,
    fontFace: KO, fontSize: 10.5, color: BODY, lineSpacingMultiple: 1.3, valign: 'top'
  })
})

// ── The numbers ───────────────────────────────────────────────────────────
const STATS = [
  { v: '4주', k: '2026.07.27 → 08.24' },
  { v: '267', k: '커밋' },
  { v: '22,700줄', k: '코드' },
  { v: '30%', k: '주석 — 판단의 이유' }
]
const STAT_Y = 5.0
const STAT_W = 2.8
STATS.forEach((s, i) => {
  const x = 0.6 + i * (STAT_W + 0.3)
  slide.addText(s.v, {
    x, y: STAT_Y, w: STAT_W, h: 0.52, margin: 0,
    fontFace: KO, fontSize: 28, bold: true, color: i === 3 ? AMBER : TEAL
  })
  slide.addText(s.k, {
    x, y: STAT_Y + 0.52, w: STAT_W, h: 0.3, margin: 0,
    fontFace: KO, fontSize: 11, color: MUTED
  })
})

// ── One concrete case, so the method is not just a claim ──────────────────
slide.addShape(pres.ShapeType.roundRect, {
  x: 0.6, y: 6.18, w: 12.1, h: 0.82,
  rectRadius: 0.08,
  fill: { color: '1B2637' },
  line: { color: '3A2C1C', width: 1 }
})
slide.addText(
  [
    { text: '실제 사례   ', options: { bold: true, color: AMBER, fontSize: 11.5 } },
    {
      text:
        '구름 영상에 흰 띠가 생기는 문제를 "아마 이것 때문"으로 넘기지 않고, 전시 PC 기록을 받아 원인을 좁혔습니다. ' +
        '위성이 안 뜨던 것도 마찬가지 — 로그에 찍힌 403의 본문을 읽어 보니 차단이 아니라 "이미 받아갔다"는 안내였습니다.',
      options: { color: BODY, fontSize: 11.5 }
    }
  ],
  {
    x: 0.85, y: 6.3, w: 11.6, h: 0.58, margin: 0,
    fontFace: KO, lineSpacingMultiple: 1.2, valign: 'middle'
  }
)

slide.addNotes(
  '핵심은 AI에게 즉흥적으로 시키지 않고, 기능마다 Markdown 설계 문서를 먼저 만든 뒤 그것을 기준으로 구현·검증했다는 점입니다. ' +
    '검증은 추측이 아니라 실제 전시 PC의 로그와 헤드리스 브라우저 테스트로 했고, 인수인계 문서까지 같은 원본에서 자동 생성되도록 만들었습니다.'
)

pres.writeFile({ fileName: 'AI활용.pptx' }).then((f) => console.log('wrote', f))
