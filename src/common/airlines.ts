// ICAO airline (operator) code → display name. The callsign's first three
// letters are the operator code (KAL902 → KAL → Korean Air), so we can identify
// the airline straight from the callsign — no external lookup, and it works even
// when adsbdb has no route for the flight. Names are Korean where the carrier is
// well known in Korea, otherwise the English brand.
//
// Not exhaustive (there are thousands of operators); this covers the major
// passenger and cargo airlines that make up the bulk of worldwide traffic.

export const AIRLINES: Record<string, string> = {
  // Korea
  KAL: '대한항공',
  AAR: '아시아나항공',
  JJA: '제주항공',
  JNA: '진에어',
  TWB: '티웨이항공',
  ABL: '에어부산',
  ASV: '에어서울',
  EOK: '에어프레미아',
  // China
  CCA: '중국국제항공',
  CES: '중국동방항공',
  CSN: '중국남방항공',
  CHH: '하이난항공',
  CSC: '쓰촨항공',
  CXA: '샤먼항공',
  CDG: '상하이항공',
  CQH: '춘추항공',
  // Hong Kong / Taiwan
  CPA: '캐세이퍼시픽',
  HDA: '캐세이드래곤',
  CAL: '중화항공',
  EVA: '에바항공',
  // Japan
  JAL: '일본항공',
  ANA: '전일본공수',
  APJ: '피치항공',
  JJP: '제트스타재팬',
  SKY: '스카이마크',
  // Southeast Asia
  SIA: '싱가포르항공',
  THA: '타이항공',
  MAS: '말레이시아항공',
  AXM: '에어아시아',
  GIA: '가루다인도네시아',
  PAL: '필리핀항공',
  CEB: '세부퍼시픽',
  VJC: '비엣젯항공',
  HVN: '베트남항공',
  // India / Middle East
  AIC: '에어인디아',
  IGO: '인디고',
  UAE: '에미레이트항공',
  QTR: '카타르항공',
  ETD: '에티하드항공',
  SVA: '사우디아',
  THY: '터키항공',
  ELY: '엘알',
  // Europe
  BAW: '영국항공',
  DLH: '루프트한자',
  AFR: '에어프랑스',
  KLM: 'KLM 네덜란드항공',
  IBE: '이베리아항공',
  AZA: 'ITA 항공',
  SWR: '스위스국제항공',
  AUA: '오스트리안항공',
  SAS: '스칸디나비아항공',
  FIN: '핀에어',
  TAP: 'TAP 포르투갈항공',
  VIR: '버진애틀랜틱',
  EIN: '에어링구스',
  RYR: '라이언에어',
  EZY: '이지젯',
  WZZ: '위즈에어',
  VLG: '부엘링',
  NAX: '노르웨이지안',
  AEE: '에게안항공',
  LOT: 'LOT 폴란드항공',
  CSA: '체코항공',
  // North America
  AAL: '아메리칸항공',
  UAL: '유나이티드항공',
  DAL: '델타항공',
  SWA: '사우스웨스트항공',
  JBU: '제트블루',
  ASA: '알래스카항공',
  NKS: '스피릿항공',
  FFT: '프론티어항공',
  ACA: '에어캐나다',
  WJA: '웨스트젯',
  // Latin America
  AMX: '아에로멕시코',
  LAN: '라탐항공',
  TAM: '라탐 브라질',
  AVA: '아비앙카',
  GLO: '골 항공',
  AZU: '아줄 항공',
  // Oceania
  QFA: '콴타스',
  JST: '제트스타',
  VOZ: '버진오스트레일리아',
  ANZ: '에어뉴질랜드',
  // Africa
  ETH: '에티오피아항공',
  MSR: '이집트항공',
  RAM: '로얄에어모로코',
  SAA: '남아프리카항공',
  KQA: '케냐항공',
  // Cargo
  FDX: '페덱스',
  UPS: 'UPS',
  GTI: '아틀라스항공',
  GEC: '루프트한자카고',
  CLX: '카고룩스',
  CKS: '칼리타항공',
  NCA: '니혼카고',
  CAO: '에어차이나카고',
  PAC: '폴라에어카고',
  BOX: '에어로로직',
  CJT: '카고젯',
  SQC: '싱가포르항공카고',
  ABW: '에어브릿지카고'
}

/** Airline name from a callsign's 3-letter operator prefix, or null if unknown. */
export function airlineFromCallsign(callsign?: string | null): string | null {
  const cs = (callsign ?? '').toUpperCase().trim()
  if (!/^[A-Z]{3}/.test(cs)) return null
  return AIRLINES[cs.slice(0, 3)] ?? null
}
