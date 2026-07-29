// IATA airport code → Korean city name, for the busiest airports worldwide.
// adsbdb gives the city in English (e.g. "Tokyo", "Guangzhou (Huadu)"); we show
// the Korean name when we know it, falling back to the English one otherwise.
// Not exhaustive — covers the major international airports that make up most of
// the traffic a visitor will select.

export const AIRPORT_CITY_KO: Record<string, string> = {
  // Korea
  ICN: '서울/인천', GMP: '서울/김포', PUS: '부산', CJU: '제주', TAE: '대구',
  // Japan
  NRT: '도쿄/나리타', HND: '도쿄/하네다', KIX: '오사카', ITM: '오사카/이타미',
  NGO: '나고야', FUK: '후쿠오카', CTS: '삿포로', OKA: '오키나와',
  // China / HK / TW / Macau
  PEK: '베이징', PKX: '베이징/다싱', PVG: '상하이/푸둥', SHA: '상하이/훙차오',
  CAN: '광저우', SZX: '선전', CTU: '청두', TFU: '청두/톈푸', CKG: '충칭',
  KMG: '쿤밍', XIY: '시안', HGH: '항저우', WUH: '우한', CGO: '정저우',
  HKG: '홍콩', TPE: '타이베이', TSA: '타이베이/쑹산', MFM: '마카오',
  // Southeast Asia
  SIN: '싱가포르', BKK: '방콕', DMK: '방콕/돈므앙', KUL: '쿠알라룸푸르',
  CGK: '자카르타', DPS: '발리', MNL: '마닐라', CEB: '세부', HAN: '하노이',
  SGN: '호치민', RGN: '양곤', PNH: '프놈펜',
  // South Asia
  DEL: '델리', BOM: '뭄바이', BLR: '벵갈루루', MAA: '첸나이', HYD: '하이데라바드',
  CCU: '콜카타', CMB: '콜롬보', DAC: '다카', KTM: '카트만두',
  // Middle East
  DXB: '두바이', AUH: '아부다비', DOH: '도하', RUH: '리야드', JED: '제다',
  KWI: '쿠웨이트', BAH: '바레인', MCT: '무스카트', TLV: '텔아비브', IKA: '테헤란',
  // Europe
  LHR: '런던/히스로', LGW: '런던/개트윅', STN: '런던/스탠스테드', MAN: '맨체스터',
  CDG: '파리/샤를드골', ORY: '파리/오를리', FRA: '프랑크푸르트', MUC: '뮌헨',
  BER: '베를린', DUS: '뒤셀도르프', AMS: '암스테르담', BRU: '브뤼셀',
  MAD: '마드리드', BCN: '바르셀로나', LIS: '리스본', FCO: '로마', MXP: '밀라노',
  VCE: '베네치아', ZRH: '취리히', GVA: '제네바', VIE: '빈', CPH: '코펜하겐',
  ARN: '스톡홀름', OSL: '오슬로', HEL: '헬싱키', DUB: '더블린', IST: '이스탄불',
  SAW: '이스탄불/사비하', ATH: '아테네', WAW: '바르샤바', PRG: '프라하',
  BUD: '부다페스트', SVO: '모스크바/셰레메티예보', DME: '모스크바/도모데도보',
  LED: '상트페테르부르크',
  // North America
  JFK: '뉴욕/JFK', EWR: '뉴욕/뉴어크', LGA: '뉴욕/라과디아', BOS: '보스턴',
  IAD: '워싱턴/덜레스', DCA: '워싱턴', PHL: '필라델피아', ATL: '애틀랜타',
  MIA: '마이애미', MCO: '올랜도', FLL: '포트로더데일', TPA: '탬파',
  ORD: '시카고/오헤어', MDW: '시카고/미드웨이', DTW: '디트로이트', MSP: '미니애폴리스',
  DFW: '댈러스', IAH: '휴스턴', DEN: '덴버', PHX: '피닉스', LAS: '라스베이거스',
  LAX: '로스앤젤레스', SFO: '샌프란시스코', SAN: '샌디에이고', SEA: '시애틀',
  PDX: '포틀랜드', SLC: '솔트레이크시티', YYZ: '토론토', YVR: '밴쿠버',
  YUL: '몬트리올', YYC: '캘거리', MEX: '멕시코시티', CUN: '칸쿤',
  // South America
  GRU: '상파울루', GIG: '리우데자네이루', BSB: '브라질리아', EZE: '부에노스아이레스',
  SCL: '산티아고', LIM: '리마', BOG: '보고타', PTY: '파나마시티',
  // Oceania
  SYD: '시드니', MEL: '멜버른', BNE: '브리즈번', PER: '퍼스', AKL: '오클랜드',
  // Africa
  CAI: '카이로', JNB: '요하네스버그', CPT: '케이프타운', NBO: '나이로비',
  ADD: '아디스아바바', LOS: '라고스', CMN: '카사블랑카', ALG: '알제'
}

/** Korean city name for an airport code, or null if we don't have it. */
export function cityKo(code?: string | null): string | null {
  if (!code) return null
  return AIRPORT_CITY_KO[code.toUpperCase().trim()] ?? null
}
