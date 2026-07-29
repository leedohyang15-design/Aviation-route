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
  ADD: '아디스아바바', LOS: '라고스', CMN: '카사블랑카', ALG: '알제',

  // --- Extended coverage (secondary cities & regional hubs) ---
  // Japan
  KOJ: '가고시마', HIJ: '히로시마', KMJ: '구마모토', SDJ: '센다이', KMQ: '고마쓰',
  TAK: '다카마쓰', MYJ: '마쓰야마', KCZ: '고치', OIT: '오이타', NGS: '나가사키',
  // China
  TAO: '칭다오', DLC: '다롄', SHE: '선양', HRB: '하얼빈', CGQ: '창춘',
  TSN: '톈진', TNA: '지난', HFE: '허페이', NKG: '난징', WUX: '우시',
  NGB: '닝보', FOC: '푸저우', XMN: '샤먼', KWL: '구이린', NNG: '난닝',
  HAK: '하이커우', SYX: '싼야', URC: '우루무치', LHW: '란저우', KWE: '구이양',
  // Taiwan / SE Asia
  KHH: '가오슝', RMQ: '타이중', CNX: '치앙마이', HKT: '푸껫', KBV: '끄라비',
  USM: '꼬사무이', SUB: '수라바야', BDO: '반둥', MDC: '마나도', DVO: '다바오',
  KLO: '칼리보', DAD: '다낭', CXR: '나트랑', PQC: '푸꾸옥', VTE: '비엔티안',
  REP: '시엠립', BWN: '반다르스리브가완',
  // India / South Asia
  GOI: '고아', COK: '코치', TRV: '트리반드룸', AMD: '아메다바드', PNQ: '푸네',
  JAI: '자이푸르', LKO: '럭나우', PAT: '파트나', GAU: '구와하티', NAG: '나그푸르',
  IXC: '찬디가르', ISB: '이슬라마바드', KHI: '카라치', LHE: '라호르', MLE: '말레',
  // Middle East
  AMM: '암만', BEY: '베이루트', DMM: '담맘', MED: '메디나', SHJ: '샤르자',
  // Europe (secondary)
  LTN: '런던/루턴', LCY: '런던시티', EDI: '에든버러', GLA: '글래스고', BHX: '버밍엄',
  BRS: '브리스틀', NCE: '니스', LYS: '리옹', MRS: '마르세유', TLS: '툴루즈',
  NTE: '낭트', BOD: '보르도', HAM: '함부르크', STR: '슈투트가르트', CGN: '쾰른',
  HAJ: '하노버', NUE: '뉘른베르크', TXL: '베를린', PMI: '팔마', AGP: '말라가',
  VLC: '발렌시아', SVQ: '세비야', BIO: '빌바오', OPO: '포르투', NAP: '나폴리',
  BLQ: '볼로냐', TRN: '토리노', CTA: '카타니아', PSA: '피사', GOT: '예테보리',
  BGO: '베르겐', TRD: '트론헤임', GDN: '그단스크', KRK: '크라쿠프', OTP: '부쿠레슈티',
  SOF: '소피아', BEG: '베오그라드', ZAG: '자그레브', LJU: '류블랴나', TLL: '탈린',
  RIX: '리가', VNO: '빌뉴스', KEF: '레이캬비크', KBP: '키예프',
  // North America (secondary)
  BWI: '볼티모어', PIT: '피츠버그', CLT: '샬럿', RDU: '롤리더럼', BNA: '내슈빌',
  MEM: '멤피스', MCI: '캔자스시티', STL: '세인트루이스', CVG: '신시내티',
  IND: '인디애나폴리스', CMH: '콜럼버스', CLE: '클리블랜드', MKE: '밀워키',
  AUS: '오스틴', SAT: '샌안토니오', MSY: '뉴올리언스', RSW: '포트마이어스',
  JAX: '잭슨빌', SMF: '새크라멘토', SJC: '새너제이', OAK: '오클랜드', SNA: '오렌지카운티',
  ONT: '온타리오', BUR: '버뱅크', RNO: '리노', ABQ: '앨버커키', TUS: '투손',
  BOI: '보이시', ANC: '앵커리지', HNL: '호놀룰루', OGG: '마우이', YOW: '오타와',
  YEG: '에드먼턴', YWG: '위니펙', YHZ: '핼리팩스',
  // Latin America
  GDL: '과달라하라', MTY: '몬테레이', TIJ: '티후아나', PVR: '푸에르토바야르타',
  SJD: '로스카보스', UIO: '키토', GYE: '과야킬', LPB: '라파스',
  MVD: '몬테비데오', ASU: '아순시온', CCS: '카라카스', SDQ: '산토도밍고',
  HAV: '아바나', SJU: '산후안', CNF: '벨루오리존치', POA: '포르투알레그리',
  REC: '헤시피', SSA: '사우바도르', FOR: '포르탈레자',
  // Oceania / Africa (secondary)
  ADL: '애들레이드', CBR: '캔버라', OOL: '골드코스트', CNS: '케언스', CHC: '크라이스트처치',
  WLG: '웰링턴', NAN: '난디', DUR: '더반', ACC: '아크라', DAR: '다르에스살람',
  TUN: '튀니스', LAD: '루안다', DKR: '다카르'
}

/** Korean city name for an airport code, or null if we don't have it. */
export function cityKo(code?: string | null): string | null {
  if (!code) return null
  return AIRPORT_CITY_KO[code.toUpperCase().trim()] ?? null
}
