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
  TUN: '튀니스', LAD: '루안다', DKR: '다카르',

  // --- Tier 3 (broader coverage) ---
  // Korea / Japan
  KWJ: '광주', RSU: '여수', USN: '울산', KUV: '군산', KPO: '포항',
  KIJ: '니가타', HKD: '하코다테', AOJ: '아오모리', OKJ: '오카야마', TOY: '도야마',
  ISG: '이시가키', KKJ: '기타큐슈', AKJ: '아사히카와', KMI: '미야자키',
  // China
  SJW: '스자좡', TYN: '타이위안', HET: '후허하오터', INC: '인촨', XNN: '시닝',
  YNT: '옌타이', CZX: '창저우', NTG: '난퉁', WNZ: '원저우', JJN: '취안저우',
  SWA: '산터우', ZUH: '주하이', DYG: '장자제', LJG: '리장', JHG: '시솽반나',
  BHY: '베이하이', ZHA: '잔장', KHN: '난창', CSX: '창사',
  // SE Asia
  PEN: '페낭', JHB: '조호르바루', LGK: '랑카위', KCH: '쿠칭', BKI: '코타키나발루',
  UPG: '마카사르', BPN: '발릭파판', JOG: '족자카르타', SRG: '스마랑', SOC: '솔로',
  CRK: '클라크', ILO: '일로일로', BCD: '바콜로드', PPS: '푸에르토프린세사',
  HPH: '하이퐁', DLI: '달랏', VCA: '껀터', THD: '타인호아',
  // India / South Asia
  BBI: '부바네스와르', VNS: '바라나시', VTZ: '비샤카파트남', IDR: '인도르',
  JDH: '조드푸르', UDR: '우다이푸르', IXB: '실리구리', RPR: '라이푸르',
  TRZ: '티루치라팔리', IXM: '마두라이', CJB: '코임바토르', BHO: '보팔',
  // Central Asia / Caucasus
  TAS: '타슈켄트', ALA: '알마티', NQZ: '아스타나', FRU: '비슈케크',
  GYD: '바쿠', EVN: '예레반', TBS: '트빌리시', ASB: '아시가바트',
  // Russia
  KZN: '카잔', SVX: '예카테린부르크', OVB: '노보시비르스크', AER: '소치',
  KRR: '크라스노다르', ROV: '로스토프', UFA: '우파', KUF: '사마라',
  VVO: '블라디보스토크', KHV: '하바롭스크', IKT: '이르쿠츠크', KGD: '칼리닌그라드',
  // Europe (secondary / regional)
  BFS: '벨파스트', NCL: '뉴캐슬', ABZ: '애버딘', LPL: '리버풀', LBA: '리즈',
  BRE: '브레멘', LEJ: '라이프치히', DRS: '드레스덴', FMO: '뮌스터', DTM: '도르트문트',
  RTM: '로테르담', EIN: '아인트호번', CRL: '샤를루아', ALC: '알리칸테', IBZ: '이비사',
  LPA: '라스팔마스', TFS: '테네리페', FUE: '푸에르테벤투라', ACE: '란사로테',
  FAO: '파루', CAG: '칼리아리', VRN: '베로나', BRI: '바리', FLR: '피렌체',
  PMO: '팔레르모', HER: '이라클리오', SKG: '테살로니키', RHO: '로도스',
  LCA: '라르나카', PFO: '파포스', MLA: '몰타', KTW: '카토비체', WRO: '브로츠와프',
  POZ: '포즈난', LUX: '룩셈부르크', INN: '인스브루크', SZG: '잘츠부르크',
  DBV: '두브로브니크', SPU: '스플리트', SJJ: '사라예보', SKP: '스코페', TIA: '티라나',
  ODS: '오데사', MSQ: '민스크', TMP: '탐페레', TRF: '오슬로/토프', SVG: '스타방에르',
  AAL: '올보르', BLL: '빌룬', MMX: '말뫼',
  // Middle East
  AHB: '아브하', TIF: '타이프', ELQ: '카심',
  // North America (regional)
  SDF: '루이빌', OMA: '오마하', OKC: '오클라호마시티', TUL: '털사', ICT: '위치토',
  DSM: '디모인', BUF: '버펄로', PVD: '프로비던스', BDL: '하트퍼드', ORF: '노퍽',
  RIC: '리치먼드', GSO: '그린즈버러', CHS: '찰스턴', SAV: '서배너', PBI: '웨스트팜비치',
  GRR: '그랜드래피즈', DAY: '데이턴', MSN: '매디슨',COS: '콜로라도스프링스',
  GEG: '스포캔', FAT: '프레즈노', PSP: '팜스프링스', BZN: '보즈먼', TYS: '녹스빌',
  LEX: '렉싱턴', ELP: '엘패소', BHM: '버밍엄', HSV: '헌츠빌', LIT: '리틀록',
  PWM: '포틀랜드', BTV: '벌링턴', MHT: '맨체스터', YQB: '퀘벡', YXE: '새스커툰',
  YLW: '켈로나', YYT: '세인트존스',
  // Latin America
  MDE: '메데인', CTG: '카르타헤나', CLO: '칼리', CUZ: '쿠스코', AQP: '아레키파',
  MDZ: '멘도사', COR: '코르도바', ROS: '로사리오', IGR: '이과수', CWB: '쿠리치바',
  VCP: '캄피나스', MAO: '마나우스', BEL: '벨렝', NAT: '나타우', FLN: '플로리아노폴리스',
  VVI: '산타크루스', GEO: '조지타운',
  // Oceania
  HBA: '호바트',DRW: '다윈', TSV: '타운스빌',
  ZQN: '퀸스타운', DUD: '더니든', POM: '포트모르즈비', NOU: '누메아', PPT: '파페에테',
 SUV: '수바', VLI: '포트빌라',
  // Africa / Indian Ocean
  HRG: '후르가다', SSH: '샤름엘셰이크', LXR: '룩소르', RAK: '마라케시', AGA: '아가디르',
  TNG: '탕헤르', FEZ: '페스', ABJ: '아비장', DLA: '두알라', LBV: '리브르빌',
  FIH: '킨샤사', BKO: '바마코', OUA: '와가두구', NDJ: '은자메나', EBB: '엔테베',
  KGL: '키갈리', MPM: '마푸토', TNR: '안타나나리보', MRU: '모리셔스', SEZ: '세이셸',
  KRT: '하르툼', ABV: '아부자', KAN: '카노', PHC: '포트하커트', WDH: '빈트후크',
  GBE: '가보로네', LUN: '루사카', HRE: '하라레', LLW: '릴롱궤'
}

/** Korean city name for an airport code, or null if we don't have it. */
export function cityKo(code?: string | null): string | null {
  if (!code) return null
  return AIRPORT_CITY_KO[code.toUpperCase().trim()] ?? null
}
