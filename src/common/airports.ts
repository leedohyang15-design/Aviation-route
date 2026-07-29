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
  GBE: '가보로네', LUN: '루사카', HRE: '하라레', LLW: '릴롱궤',

  // --- Tier 4 (broad long-tail coverage) ---
  // India (dense)
  GOX: '고아/모파', SXR: '스리나가르', IXE: '망갈로르', CCJ: '코지코드', CNN: '칸누르',
  IXJ: '잠무', DED: '데라둔', LEH: '레', IXL: '레', PNY: '퐁디셰리', TIR: '티루파티',
  VGA: '비자야와다', RJA: '라자문드리', HBX: '후블리', IXG: '벨가움', STV: '수라트',
  BDQ: '바도다라', RAJ: '라지코트', IXU: '아우랑가바드', NDC: '난데드', IXR: '란치',
  IXW: '잠셰드푸르', IXA: '아가르탈라', IMF: '임팔', DIB: '디브루가르', JRH: '조르하트',
  SHL: '실롱', AJL: '아이자울', DMU: '디마푸르', GAY: '가야', DBR: '다르방가',
  KNU: '칸푸르', IXD: '프라야그라지', GWL: '괄리오르', JLR: '자발푸르',
  KJB: '코임바토르', SXV: '살렘', TCR: '투티코린', MYQ: '마이소르',
  // Sri Lanka / Nepal / Pakistan / Bangladesh
  HRI: '함반토타', PKR: '포카라', BWA: '바이라와', KEP: '네팔간지', MPX: '목포',
  PEW: '페샤와르', UET: '퀘타', MUX: '물탄', SKT: '시알코트', LYP: '파이살라바드',
  CGP: '치타공', ZYL: '실레트', CXB: '콕스바자르', JSR: '제소르',
  // China (secondary)
  DLU: '다리', BFJ: '비제', LZO: '루저우', LZH: '류저우', ENH: '언스', YIH: '이창',
  XFN: '샹양', WDS: '스옌', LYA: '뤄양', NNY: '난양', HIA: '화이안', YTY: '양저우',
  LYG: '롄윈강', JNG: '지닝', DZH: '다저우', MIG: '몐양', NAO: '난충', WXN: '완저우',
  ACX: '싱이', AKU: '아커쑤', KHG: '카스', KRL: '쿠얼러', IQM: '이닝', HTN: '호탄',
  DNH: '둔황', JGN: '자위관', GOQ: '거얼무', ZQZ: '장자커우', BAV: '바오터우',
  HLD: '하이라얼', NZH: '만저우리', YNJ: '옌지', MDG: '무단장', JMU: '자무쓰',
  // Japan (regional)
  AXT: '아키타', GAJ: '야마가타', FKS: '후쿠시마', SHM: '시라하마',
  TTJ: '돗토리', IZO: '이즈모', YGJ: '요나고', IWJ: '이와미', KUM: '야쿠시마',
  TKS: '도쿠시마', UBJ: '야마구치/우베', TSJ: '쓰시마', FKJ: '후쿠이',
  SDS: '사도', HAC: '하치조지마', MMB: '메만베쓰', KUH: '구시로', OBO: '오비히로',
  WKJ: '왁카나이', SHB: '나카시베쓰',
  // SE Asia (more)
  PLM: '팔렘방', PKU: '페칸바루', BTH: '바탐', PDG: '파당', BKS: '벵쿨루',
  TKG: '반다르람풍', LOP: '롬복', KOE: '쿠팡', BIK: '비악',
  DJJ: '자야푸라', TTE: '테르나테', AMQ: '암본', MKQ: '메라우케', GTO: '고론탈로',
  PLW: '팔루', KDI: '켄다리', TRK: '타라칸', BDJ: '반자르마신', PKY: '팡칼란분', TGG: '쿠알라트렝가누', KBR: '코타바루', AOR: '알로르스타르',
  MYY: '미리', SBW: '시부', TWU: '타와우', SDK: '산다칸', LBU: '라부안', LPQ: '루앙프라방', PKZ: '팍세', ZVK: '사반나켓', UTH: '우돈타니',
  UBP: '우본랏차타니', KKC: '콘깬', HDY: '핫야이', URT: '수랏타니', TST: '뜨랑',
  NST: '나콘시탐마랏', LPT: '람빵', HGN: '매홍손', BFV: '부리람', VII: '빈', VDH: '동호이', TBB: '뚜이호아', VCL: '추라이', UIH: '뀌년',
  VCS: '꼰다오', BMV: '부온마투옷', PXU: '플레이쿠', VKG: '라익자',
  // Middle East / Central Asia (more)
  NJF: '나자프', BSR: '바스라', EBL: '에르빌', ISU: '술라이마니야', BGW: '바그다드',
  SYZ: '시라즈', MHD: '마슈하드', IFN: '이스파한', TBZ: '타브리즈', AWZ: '아흐바즈',
  KIH: '키시', BND: '반다르아바스', RKT: '라스알카이마',
  SLL: '살랄라', AAN: '알아인', DWC: '두바이/월드센트럴', KGF: '카라간다',
  SCO: '아크타우', GUW: '아티라우', DYU: '두샨베', LBD: '후잔트',
  UGC: '우르겐치', BHK: '부하라', SKD: '사마르칸트', NMA: '나망간', FEG: '페르가나',
  // Africa (more)
  SPX: '카이로/스핑크스', HBE: '알렉산드리아', ASW: '아스완', RMF: '마르사알람',
  OUD: '우지다', NDR: '나도르', RBA: '라바트', VIL: '다클라', MIR: '모나스티르', TOE: '토주르', MBA: '몸바사', ZNZ: '잔지바르', JRO: '킬리만자로', DOD: '도도마',
  MWZ: '음완자', ENU: '에누구', KMS: '쿠마시',
  TML: '타말레', ROB: '몬로비아', FNA: '프리타운', BJL: '반줄',
  BOY: '보보디울라소', NIM: '니아메', ZND: '진데르',
  // Europe (more)
  BOH: '본머스', EXT: '엑서터', NQY: '뉴키', INV: '인버네스', SOU: '사우샘프턴',
  DND: '던디', HUY: '험버사이드', DSA: '돈캐스터',
  BVA: '파리/보베', LIL: '릴', LRT: '로리앙', RNS: '렌', CFE: '클레르몽페랑',
  ETZ: '메스', EGC: '베르주라크', PGF: '페르피냥', FNI: '님', BIQ: '비아리츠',
  AJA: '아작시오', BIA: '바스티아', CLY: '칼비',
  DOL: '도빌', LDE: '루르드', RDZ: '로데즈', BES: '브레스트',
  FMM: '멤밍겐', FKB: '카를스루에', PAD: '파더보른', ERF: '에르푸르트', FDH: '프리드리히스하펜',
  SCN: '자르브뤼켄', NRN: '니더라인',
  MST: '마스트리흐트', GRQ: '흐로닝언', ANR: '안트베르펜', OST: '오스텐더',
  RJK: '리예카', OSI: '오시예크',
  SZZ: '슈체친', BZG: '비드고슈치', LUZ: '루블린', RZE: '제슈프',
  BRQ: '브르노', OSR: '오스트라바', PED: '파르두비체',
  KSC: '코시체', NAV: '네브셰히르', ASR: '카이세리', ADA: '아다나',
  GZT: '가지안테프', TZX: '트라브존', VAN: '반', ERZ: '에르주룸', DIY: '디야르바키르',
  MLX: '말라티아', KYA: '콘야', BJV: '보드룸', ADB: '이즈미르', DLM: '달라만', AYT: '안탈리아',
  // North America (more regional)
  FAI: '페어뱅크스', JNU: '주노', KTN: '케치칸', SIT: '싯카', BET: '베델',
  GTF: '그레이트폴스', HLN: '헬레나', BIL: '빌링스', MSO: '미줄라', GPI: '칼리스펠',
  IDA: '아이다호폴스', TWF: '트윈폴스', PIH: '포카텔로', CPR: '캐스퍼', COD: '코디',
  RAP: '래피드시티', FSD: '수폴스', BIS: '비즈마크', FAR: '파고', GFK: '그랜드포크스',
  RST: '로체스터', DLH: '덜루스', FCA: '칼리스펠',
  GRB: '그린베이', ATW: '애플턴', CID: '시더래피즈', MLI: '몰린',
  PIA: '피오리아', SPI: '스프링필드', EVV: '에번즈빌', FWA: '포트웨인', SBN: '사우스벤드',
  TOL: '털리도', CAK: '애크런',
  ROA: '로어노크', LYH: '린치버그', CHO: '샬러츠빌', CRW: '찰스턴',
  MYR: '머틀비치', ILM: '윌밍턴', FAY: '페이엣빌', AVL: '애슈빌', GSP: '그린빌',
  CAE: '컬럼비아', TLH: '탤러해시', GNV: '게인즈빌', PNS: '펜서콜라', VPS: '포트월턴비치',
  MOB: '모빌', SHV: '슈리브포트', BTR: '배턴루지', LFT: '러파예트', JAN: '잭슨',
  XNA: '페이엣빌', SGF: '스프링필드', BRO: '브라운즈빌', MFE: '매캘런',
  CRP: '코퍼스크리스티', LBB: '러벅', AMA: '애머릴로', MAF: '미들랜드',
  ABI: '애빌린', GJT: '그랜드정션', DRO: '두랑고', MTJ: '몬트로즈', ASE: '아스펜',
  EGE: '이글', HDN: '헤이든', SBP: '샌루이스오비스포',
  SBA: '샌타바버라', MRY: '몬터레이', SMX: '샌타마리아', ACV: '아케이타', RDM: '레드먼드',
  MFR: '메드퍼드', EUG: '유진', PSC: '패스코', YKM: '야키마', BLI: '벨링햄',
  // Canada (more)
  YQR: '리자이나', YXS: '프린스조지', YXX: '애버츠퍼드', YQT: '선더베이', YZF: '옐로나이프',
  YFB: '이칼루이트', YQG: '윈저', YKA: '캠룹스', YCD: '나나이모', YQQ: '코목스',
  // Latin America (more)
  BAQ: '바랑키야', SMR: '산타마르타', PEI: '페레이라', AXM: '아르메니아', BGA: '부카라망가',
  ADZ: '산안드레스', CUC: '쿠쿠타', VVC: '비야비센시오', TRU: '트루히요', PIU: '피우라',
  IQT: '이키토스', TPP: '타라포토', CIX: '치클라요', JUL: '훌리아카', PEM: '푸에르토말도나도',
  CJA: '카하마르카', TDD: '트리니다드', CBB: '코차밤바', SRE: '수크레',
  IGU: '이과수', CGB: '쿠이아바', GYN: '고이아니아', SLZ: '상루이스', THE: '테레지나',
  MCZ: '마세이오', AJU: '아라카주', JPA: '주앙페소아', CGR: '캄푸그란지', PVH: '포르투벨류',
  RBR: '히우브랑쿠', MAB: '마라바', STM: '산타렝', PMW: '팔마스', IOS: '일례우스',
  NVT: '나비간치스', LDB: '론드리나', MGF: '마링가', CXJ: '카시아스두술', UDI: '우베를란지아',
  RAO: '히베이랑프레투', BPS: '포르투세구루', PPB: '프레지덴치프루덴치',
  // Oceania (more)
  MKY: '매카이', HTI: '해밀턴아일랜드', PPP: '프로서파인', ABX: '올버리', AVV: '아발론',
  LST: '론서스턴', NTL: '뉴캐슬', CFS: '코프스하버',
  BME: '브룸', KTA: '카라타', PHE: '포트헤들랜드', GET: '제럴턴', KGI: '칼굴리', LEA: '리어몬스', AYQ: '에어즈록/울룰루', ASP: '앨리스스프링스',
  ISA: '마운트아이자', GLT: '글래드스톤', BDB: '번더버그', HVB: '허비베이',
  NPE: '네이피어', NPL: '뉴플리머스', PMR: '파머스턴노스', NSN: '넬슨', BHE: '블레넘',
  TRG: '타우랑가', ROT: '로토루아', GIS: '기즈번', HLZ: '해밀턴', IVC: '인버카길',
  FUN: '푸나푸티', TBU: '통가타푸', APW: '아피아', RAR: '라로통가', GEA: '누메아',
  // Misc additions
  CHQ: '하니아', AFW: '포트워스', JMK: '미코노스', JTR: '산토리니', KGS: '코스',
  ZTH: '자킨토스', EFL: '케팔로니아', PVK: '프레베자', GPA: '파트라', KLX: '칼라마타',
  AOK: '카르파토스', SMI: '사모스', MJT: '미틸리니', JSI: '스키아토스',
  BGY: '베르가모', VBS: '브레시아', RMI: '리미니', AOI: '안코나', PEG: '페루자',
  CIY: '코미소', REG: '레조칼라브리아', SUF: '람베치아', BDS: '브린디시',
  FSC: '피가리', CMF: '샹베리', GNB: '그르노블', GOU: '가루아'
}

/** Korean city name for an airport code, or null if we don't have it. */
export function cityKo(code?: string | null): string | null {
  if (!code) return null
  return AIRPORT_CITY_KO[code.toUpperCase().trim()] ?? null
}
