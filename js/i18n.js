// The interface's words in English and Thai. The choice is a per-device
// convenience, so it lives in the browser and never reaches the database.

const STORAGE_KEY = 'dramedy-language';

export const LANGUAGES = [
  { id: 'th', short: 'TH', name: 'ไทย', locale: 'th-TH' },
  { id: 'en', short: 'EN', name: 'English', locale: 'en-GB' },
];

export const messages = {
  en: {
    loading: 'Loading…',
    language: 'Language',
    sections: 'Sections',
    demo: 'Demo',

    'tab.overview': 'Overview',
    'tab.stocks': 'Stocks',
    'tab.trades': 'Trades',
    'tab.add': 'Add',
    'tab.more': 'More',

    'title.overview': 'Overview',
    'title.stocks': 'Stocks',
    'title.trades': 'Trades',
    'title.add': 'Add',
    'title.more': 'More',

    'type.buy': 'Buy',
    'type.sell': 'Sell',
    'type.dividend': 'Dividend',
    'type.withholding': 'Dividend tax',
    'type.fee_sec': 'SEC fee',
    'type.fee_taf': 'TAF fee',
    'type.fee_cat': 'CAT fee',
    'type.commission_refund': 'Commission refund',
    'type.deposit': 'Deposit',
    'type.withdrawal': 'Withdrawal',
    'type.fx_in': 'Exchange in',
    'type.fx_out': 'Exchange out',

    'error.emailLimit': 'Too many sign-in emails. The free plan sends about 2 an hour, so try again later or sign in with your password.',
    'error.credentials': 'Wrong email or password. If you haven’t set a password yet, sign in with an email link first.',
    'error.network': 'Can’t reach the database. If the app has been idle for a week, restore the project in the Supabase dashboard.',
    'error.duplicate': 'This trade is already here, so nothing was added.',
    'error.join': '. ',
    'error.more': ' and {count} more',

    'empty.title': 'Your story starts here',
    'empty.text': 'Import your trade history to bring this place to life.',
    'empty.action': 'Import trades',

    'priced.all': 'All stocks priced',
    'priced.some': '{priced} of {held} stocks priced',

    'overall.label': 'Overall',
    'overall.formula': 'Total profit + Unrealized',
    'overall.incomplete': 'Incomplete: {priced}',
    'overall.share': '{percent}% of money added',

    'hero.label': 'Total profit',
    'hero.hint': 'Realized profit, plus dividends, minus fees',

    'review.title.one': '{count} stock needs a status',
    'review.title.many': '{count} stocks need a status',
    'review.hint': 'Its profit isn’t counted until then',

    'tile.realized': 'Realized',
    'tile.realizedHint': 'Profit taken so far',
    'tile.unrealized': 'Unrealized',
    'tile.marketValue': 'Market value',
    'tile.invested': 'Still invested',
    'tile.investedHint': 'At cost',
    'tile.cash': 'Cash balance',
    'tile.cashHint': 'From your rows',
    'tile.moneyAdded': 'Money added',
    'tile.moneyAddedHint': 'Deposits and exchanges',
    'tile.dividends': 'Dividends',
    'tile.dividendsHint': 'After tax',
    'tile.fees': 'Fees',
    'tile.feesHint': 'After refunds',

    'chart.title': 'Profit by month',
    'chart.empty': 'Mark a stock as fully sold to see it here.',
    'chart.footer': 'Each stock’s whole realized profit appears in the month of its latest sale.',

    'status.label': 'Status of {ticker}',
    'status.updated': '{ticker} updated',
    'status.review': 'Needs status',
    'status.holding': 'Still holding',
    'status.sold': 'Fully sold',
    'status.confirmSold': 'Mark {ticker} as fully sold? This deletes its saved {shares} shares and {cost} cost.',

    'stock.held': '{shares} shares · {cost} avg cost',
    'stock.noPrice': 'Sync market prices to see unrealized profit',
    'stock.price': '{price} price · {value} value',
    'stock.priceOn': '{price} price on {day} · {value} value',
    'stock.unrealized': 'Unrealized',
    'stock.realized': 'Realized',
    'stock.invested': 'Invested',
    'stock.profit': 'Profit',
    'stock.trades': 'Bought {bought} · Sold {sold}',
    'stock.sharesHeld': '{shares} shares held',
    'stock.oversold': 'More shares sold than bought. A buy may be missing.',
    'stock.outdated': 'A trade has no share count, so update this in Holdings',
    'stock.fromShares': 'Status comes from your share counts',

    'filter.label': 'Filter stocks',
    'filter.all': 'All',
    'filter.review': 'Review',
    'filter.holding': 'Holding',
    'filter.sold': 'Sold',
    'filter.empty': 'Nothing in this group.',

    'trade.shares': '{shares} shares',
    'trade.confirmDelete': 'Delete {label} ({amount})?',
    'trade.deleted': 'Trade deleted',
    'trade.delete': 'Delete trade',
    'trade.noMatch': 'No trades match.',
    'trade.search': 'Search ticker',
    'trade.filterType': 'Filter by type',
    'trade.allTypes': 'All types',
    'trade.added': 'Trade added',

    'form.type': 'Type',
    'form.ticker': 'Ticker',
    'form.shares': 'Shares',
    'form.amount': 'Amount (USD)',
    'form.amountHint': 'Enter the total amount, including any fees.',
    'form.date': 'Date',
    'form.note': 'Note',
    'form.timezone': 'Times are in Bangkok time.',
    'form.required': 'Required',
    'form.optional': 'Optional',
    'form.save': 'Save Trade',

    'data.title': 'Your data',
    'data.import': 'Import CSV',
    'data.export': 'Export All Trades',
    'data.footer': 'Importing twice is safe because rows already here are skipped. The free database plan has no automatic backups, so export now and then and keep the file private.',
    'data.exported': 'Exported {count} rows',
    'data.importFailed': 'Nothing was imported. {errors}{more}.',
    'data.imported': 'Added {added} new, skipped {skipped} already here.',
    'data.filled': 'Filled in shares on {count}.',
    'data.confirmSimilar.one': '{count} row may be a trade already here. Save it anyway?',
    'data.confirmSimilar.many': '{count} rows may be trades already here. Save them anyway?',

    'add.label': 'What to add',
    'add.trade': 'Trade',
    'add.holdings': 'Holdings',

    'sync.title': 'Sync Market Prices',
    'sync.last': 'Last updated {date}',
    'sync.never': 'No prices yet',
    'sync.running': 'Fetching prices…',
    'sync.done.one': 'Updated {count} price.',
    'sync.done.many': 'Updated {count} prices.',
    'sync.missed': 'No price found for {tickers}.',
    'sync.none': 'No prices came back. Try again later.',
    'sync.error': 'Couldn’t fetch market prices. Try again later.',

    'holdings.shares': 'Outstanding Shares',
    'holdings.perShare': 'Cost per Share (USD)',
    'holdings.total': 'Total Cost (USD)',
    'holdings.amount': 'Amount (USD)',
    'holdings.add': 'Add Stock',
    'holdings.remove': 'Remove this row',
    'holdings.save': 'Save Holdings',
    'holdings.check': 'Unrealized for these stocks: {amount}. Check that this matches Dime.',
    'holdings.failed': 'Nothing was saved. {errors}.',
    'holdings.confirm': 'Save these stocks?',
    'holdings.newLine': '{ticker}: new, {shares} shares at {cost}',
    'holdings.sharesChange': 'shares {from} → {to}',
    'holdings.costChange': 'cost {from} → {to}',
    'holdings.resultChange': 'unrealized {from} → {to}',
    'holdings.noChange': 'no change',
    'holdings.heldHint': 'Held: {shares} shares. Blank figures keep what’s saved.',
    'holdings.newHint': 'New stock: shares and cost are required.',
    'holdings.saved': '{count} holdings saved',
    'holdings.footer': 'Figures are as listed for each stock in Dime. Amount is the มูลค่า(USD) line, which is the gain or loss, so a loss needs a minus sign. A blank total cost is worked out from shares and cost per share.',
    'holdings.checkFigures': 'Shares × cost per share doesn’t match the total cost. Check them.',
    'holdings.nothing': '{ticker}: enter at least one figure',
    'holdings.none': 'Add at least one stock',
    'holdings.badTicker': 'Row {row} needs a valid ticker',
    'holdings.twice': '{ticker} is listed twice',
    'holdings.noShares': '{ticker} has no share count',
    'holdings.noTotal': '{ticker} has no total cost',
    'holdings.lossTooLarge': '{ticker}: the loss is larger than the total cost',

    'image.import': 'Import from Images',
    'image.loading': 'Getting ready to read…',
    'image.reading': 'Reading image {current} of {total}…',
    'image.failed': 'Couldn’t read the image.',

    'tradeImage.none': 'No trades found. Use a screenshot of the รายการ screen in Dime.',
    'tradeImage.read.one': 'Read {count} row.',
    'tradeImage.read.many': 'Read {count} rows.',
    'tradeImage.doubtful': '{count} marked in red need checking.',
    'check.done': 'Checked',
    'check.waiting.one': '{count} row still to check',
    'check.waiting.many': '{count} rows still to check',

    'tradeImage.checkAmount': 'Check the amount and type',
    'tradeImage.checkDate': 'Check the date and time',
    'tradeImage.checkTicker': 'Check the ticker',
    'tradeImage.same': 'Already here, so this row will be skipped.',
    'tradeImage.fill': 'Already here. Its share count will be filled in.',
    'tradeImage.similar': 'May be the trade from {time}. Remove this row if it is.',
    'tradeImage.sameCount': 'Already here: {count}.',
    'tradeImage.similarCount': 'Possible duplicates: {count}.',
    'tradeImage.footer': 'Nothing is saved yet, and rows already here are skipped. The รายการ screen has no share counts, so enter them on buys and sells for holdings to carry on automatically.',
    'tradeImage.save': 'Save All',
    'tradeImage.cancel': 'Cancel',
    'tradeImage.confirmCancel': 'Discard these rows? Nothing has been saved.',

    'password.title': 'Password',
    'password.new': 'New password',
    'password.hint': '12+ characters',
    'password.save': 'Save Password',
    'password.saved': 'Password saved. You can now sign in with it on any device.',

    'account.title': 'Account',
    'account.signedIn': 'Signed in as',
    'account.signOut': 'Sign Out',

    'login.tagline': 'Every trade tells a story.',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.signIn': 'Sign In',
    'login.link': 'Email me a link instead',
    'login.signingIn': 'Signing in…',
    'login.sending': 'Sending…',
    'login.checkEmail': 'Check your email for the sign-in link. Open it in this browser.',

    'csv.unknownType': 'Unknown type "{type}"',
    'csv.invalidDate': 'Invalid date "{value}"',
    'csv.needsTicker': '{type} needs a valid ticker',
    'csv.invalidAmount': 'Invalid amount "{value}"',
    'csv.wrongSign': 'The amount for {type} has the wrong sign',
    'csv.invalidShares': 'Invalid shares "{value}"',
    'csv.noteTooLong': 'Note is longer than 500 characters',
    'csv.empty': 'The file is empty',
    'csv.missingColumn': 'Missing column: {columns}',
    'csv.line': 'Line {line}: {error}',

  },

  th: {
    loading: 'กำลังโหลด…',
    language: 'ภาษา',
    sections: 'เมนูหลัก',
    demo: 'ตัวอย่าง',

    'tab.overview': 'ภาพรวม',
    'tab.stocks': 'หุ้น',
    'tab.trades': 'รายการ',
    'tab.add': 'เพิ่ม',
    'tab.more': 'อื่นๆ',

    'title.overview': 'ภาพรวม',
    'title.stocks': 'หุ้น',
    'title.trades': 'รายการ',
    'title.add': 'เพิ่ม',
    'title.more': 'อื่นๆ',

    'type.buy': 'ซื้อ',
    'type.sell': 'ขาย',
    'type.dividend': 'เงินปันผล',
    'type.withholding': 'ภาษีเงินปันผล',
    'type.fee_sec': 'ค่าธรรมเนียม SEC',
    'type.fee_taf': 'ค่าธรรมเนียม TAF',
    'type.fee_cat': 'ค่าธรรมเนียม CAT',
    'type.commission_refund': 'คืนค่าคอมมิชชัน',
    'type.deposit': 'ฝากเงิน',
    'type.withdrawal': 'ถอนเงิน',
    'type.fx_in': 'แลกเงินเข้า',
    'type.fx_out': 'แลกเงินออก',

    'error.emailLimit': 'ส่งอีเมลเข้าสู่ระบบบ่อยเกินไป แพ็กเกจฟรีส่งได้ประมาณชั่วโมงละ 2 ฉบับ ลองใหม่ภายหลังหรือเข้าสู่ระบบด้วยรหัสผ่าน',
    'error.credentials': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง ถ้ายังไม่เคยตั้งรหัสผ่าน ให้เข้าสู่ระบบด้วยลิงก์ทางอีเมลก่อน',
    'error.network': 'เชื่อมต่อฐานข้อมูลไม่ได้ ถ้าไม่ได้เปิดแอปมาหนึ่งสัปดาห์ ให้กู้คืนโปรเจกต์ใน Supabase dashboard',
    'error.duplicate': 'มีรายการนี้อยู่แล้ว จึงไม่ได้เพิ่มซ้ำ',
    'error.join': ' · ',
    'error.more': ' และอีก {count} รายการ',

    'empty.title': 'เรื่องราวของคุณเริ่มที่นี่',
    'empty.text': 'นำเข้าประวัติการซื้อขายเพื่อเริ่มใช้งาน',
    'empty.action': 'นำเข้ารายการ',

    'priced.all': 'มีราคาครบทุกตัว',
    'priced.some': 'มีราคา {priced} จาก {held} ตัว',

    'overall.label': 'ผลรวมทั้งพอร์ต',
    'overall.formula': 'กำไรรวม + กำไรที่ยังไม่รับรู้',
    'overall.incomplete': 'ยังไม่ครบ: {priced}',
    'overall.share': '{percent}% ของเงินที่ใส่เข้ามา',

    'hero.label': 'กำไรรวม',
    'hero.hint': 'กำไรที่รับรู้แล้ว บวกเงินปันผล หักค่าธรรมเนียม',

    'review.title.one': 'มีหุ้น {count} ตัวที่ต้องระบุสถานะ',
    'review.title.many': 'มีหุ้น {count} ตัวที่ต้องระบุสถานะ',
    'review.hint': 'ระบบจะยังไม่นับกำไรจนกว่าจะระบุ',

    'tile.realized': 'กำไรที่รับรู้แล้ว',
    'tile.realizedHint': 'กำไรที่ได้จากการขาย',
    'tile.unrealized': 'กำไรที่ยังไม่รับรู้',
    'tile.marketValue': 'มูลค่าตลาด',
    'tile.invested': 'เงินลงทุนคงเหลือ',
    'tile.investedHint': 'ตามต้นทุน',
    'tile.cash': 'เงินสดคงเหลือ',
    'tile.cashHint': 'คำนวณจากรายการ',
    'tile.moneyAdded': 'เงินที่ใส่เข้ามา',
    'tile.moneyAddedHint': 'ฝากเงินและแลกเงิน',
    'tile.dividends': 'เงินปันผล',
    'tile.dividendsHint': 'หลังหักภาษี',
    'tile.fees': 'ค่าธรรมเนียม',
    'tile.feesHint': 'หลังหักเงินคืน',

    'chart.title': 'กำไรรายเดือน',
    'chart.empty': 'ระบุว่าหุ้นขายหมดแล้ว เพื่อให้แสดงที่นี่',
    'chart.footer': 'กำไรที่รับรู้แล้วทั้งหมดของหุ้นแต่ละตัว จะแสดงในเดือนที่ขายครั้งล่าสุด',

    'status.label': 'สถานะของ {ticker}',
    'status.updated': 'อัปเดต {ticker} แล้ว',
    'status.review': 'รอระบุสถานะ',
    'status.holding': 'ยังถืออยู่',
    'status.sold': 'ขายหมดแล้ว',
    'status.confirmSold': 'ระบุว่า {ticker} ขายหมดแล้วใช่ไหม ระบบจะลบจำนวน {shares} หุ้น และต้นทุน {cost} ที่บันทึกไว้',

    'stock.held': '{shares} หุ้น · ต้นทุนเฉลี่ย {cost}',
    'stock.noPrice': 'อัปเดตราคาจากตลาดเพื่อดูกำไรที่ยังไม่รับรู้',
    'stock.price': 'ราคา {price} · มูลค่า {value}',
    'stock.priceOn': 'ราคา {price} เมื่อ {day} · มูลค่า {value}',
    'stock.unrealized': 'ยังไม่รับรู้',
    'stock.realized': 'รับรู้แล้ว',
    'stock.invested': 'เงินลงทุน',
    'stock.profit': 'กำไร',
    'stock.trades': 'ซื้อ {bought} · ขาย {sold}',
    'stock.sharesHeld': 'ถืออยู่ {shares} หุ้น',
    'stock.oversold': 'ขายมากกว่าที่ซื้อ อาจมีรายการซื้อตกหล่น',
    'stock.outdated': 'มีรายการที่ไม่มีจำนวนหุ้น โปรดอัปเดตในหุ้นที่ถืออยู่',
    'stock.fromShares': 'สถานะคำนวณจากจำนวนหุ้น',

    'filter.label': 'กรองหุ้น',
    'filter.all': 'ทั้งหมด',
    'filter.review': 'รอระบุ',
    'filter.holding': 'ถืออยู่',
    'filter.sold': 'ขายแล้ว',
    'filter.empty': 'ไม่มีหุ้นในกลุ่มนี้',

    'trade.shares': '{shares} หุ้น',
    'trade.confirmDelete': 'ลบ {label} ({amount}) ใช่ไหม',
    'trade.deleted': 'ลบรายการแล้ว',
    'trade.delete': 'ลบรายการ',
    'trade.noMatch': 'ไม่พบรายการ',
    'trade.search': 'ค้นหาชื่อหุ้น',
    'trade.filterType': 'กรองตามประเภท',
    'trade.allTypes': 'ทุกประเภท',
    'trade.added': 'เพิ่มรายการแล้ว',

    'form.type': 'ประเภท',
    'form.ticker': 'ชื่อหุ้น',
    'form.shares': 'จำนวนหุ้น',
    'form.amount': 'จำนวนเงิน (USD)',
    'form.amountHint': 'กรอกจำนวนเงินทั้งหมด รวมค่าธรรมเนียมแล้ว',
    'form.date': 'วันที่',
    'form.note': 'หมายเหตุ',
    'form.timezone': 'เวลาทั้งหมดเป็นเวลาไทย',
    'form.required': 'จำเป็น',
    'form.optional': 'ไม่บังคับ',
    'form.save': 'บันทึกรายการ',

    'data.title': 'ข้อมูลของคุณ',
    'data.import': 'นำเข้า CSV',
    'data.export': 'ส่งออกรายการทั้งหมด',
    'data.footer': 'นำเข้าซ้ำได้อย่างปลอดภัย เพราะแถวที่มีอยู่แล้วจะถูกข้าม ฐานข้อมูลแพ็กเกจฟรีไม่มีการสำรองอัตโนมัติ จึงควรส่งออกเก็บไว้เป็นระยะและเก็บไฟล์เป็นความลับ',
    'data.exported': 'ส่งออก {count} แถวแล้ว',
    'data.importFailed': 'ไม่ได้นำเข้าข้อมูล: {errors}{more}',
    'data.imported': 'เพิ่มใหม่ {added} แถว ข้าม {skipped} แถวที่มีอยู่แล้ว',
    'data.filled': 'เติมจำนวนหุ้นให้ {count} แถว',
    'data.confirmSimilar.one': 'มี {count} แถวที่อาจซ้ำกับรายการเดิม บันทึกต่อไหม',
    'data.confirmSimilar.many': 'มี {count} แถวที่อาจซ้ำกับรายการเดิม บันทึกต่อไหม',

    'add.label': 'เลือกสิ่งที่จะเพิ่ม',
    'add.trade': 'รายการ',
    'add.holdings': 'หุ้นที่ถืออยู่',

    'sync.title': 'อัปเดตราคาจากตลาด',
    'sync.last': 'อัปเดตล่าสุด {date}',
    'sync.never': 'ยังไม่มีราคา',
    'sync.running': 'กำลังดึงราคา…',
    'sync.done.one': 'อัปเดตราคา {count} ตัวแล้ว',
    'sync.done.many': 'อัปเดตราคา {count} ตัวแล้ว',
    'sync.missed': 'ไม่พบราคาของ {tickers}',
    'sync.none': 'ไม่ได้รับราคา โปรดลองใหม่ภายหลัง',
    'sync.error': 'ดึงราคาจากตลาดไม่สำเร็จ โปรดลองใหม่ภายหลัง',

    'holdings.shares': 'จำนวนหุ้นคงเหลือ',
    'holdings.perShare': 'ต้นทุนต่อหุ้น(USD)',
    'holdings.total': 'ต้นทุนรวม(USD)',
    'holdings.amount': 'มูลค่า(USD)',
    'holdings.add': 'เพิ่มหุ้น',
    'holdings.remove': 'ลบแถวนี้',
    'holdings.save': 'บันทึกหุ้นที่ถืออยู่',
    'holdings.check': 'กำไร/ขาดทุนของหุ้นเหล่านี้: {amount} โปรดตรวจว่าตรงกับ Dime',
    'holdings.failed': 'ไม่ได้บันทึกข้อมูล: {errors}',
    'holdings.confirm': 'บันทึกหุ้นเหล่านี้ใช่ไหม',
    'holdings.newLine': '{ticker}: หุ้นใหม่ {shares} หุ้น ต้นทุน {cost}',
    'holdings.sharesChange': 'จำนวนหุ้น {from} → {to}',
    'holdings.costChange': 'ต้นทุน {from} → {to}',
    'holdings.resultChange': 'กำไร/ขาดทุน {from} → {to}',
    'holdings.noChange': 'ไม่เปลี่ยน',
    'holdings.heldHint': 'ถืออยู่ {shares} หุ้น ช่องที่เว้นว่างจะคงค่าเดิม',
    'holdings.newHint': 'หุ้นใหม่ ต้องกรอกจำนวนหุ้นและต้นทุน',
    'holdings.saved': 'บันทึกหุ้นที่ถืออยู่ {count} ตัวแล้ว',
    'holdings.footer': 'กรอกตามรายการของแต่ละหุ้นใน Dime ช่อง มูลค่า(USD) คือกำไร/ขาดทุน จึงต้องใส่เครื่องหมายลบเมื่อขาดทุน ถ้าเว้นต้นทุนรวม ระบบจะคำนวณจากจำนวนหุ้นและต้นทุนต่อหุ้น',
    'holdings.checkFigures': 'จำนวนหุ้น × ต้นทุนต่อหุ้น ไม่ตรงกับต้นทุนรวม โปรดตรวจ',
    'holdings.nothing': '{ticker}: กรอกอย่างน้อย 1 ช่อง',
    'holdings.none': 'เพิ่มหุ้นอย่างน้อย 1 ตัว',
    'holdings.badTicker': 'แถวที่ {row} ชื่อหุ้นไม่ถูกต้อง',
    'holdings.twice': '{ticker} อยู่ในรายการซ้ำ',
    'holdings.noShares': '{ticker} ไม่มีจำนวนหุ้น',
    'holdings.noTotal': '{ticker} ไม่มีต้นทุนรวม',
    'holdings.lossTooLarge': '{ticker}: ขาดทุนมากกว่าต้นทุนรวม',

    'image.import': 'นำเข้าจากภาพ',
    'image.loading': 'กำลังเตรียมอ่านภาพ…',
    'image.reading': 'กำลังอ่านภาพ {current} จาก {total}…',
    'image.failed': 'อ่านภาพไม่สำเร็จ',

    'tradeImage.none': 'ไม่พบรายการในภาพ โปรดใช้ภาพหน้า รายการ ใน Dime',
    'tradeImage.read.one': 'อ่านได้ {count} แถว',
    'tradeImage.read.many': 'อ่านได้ {count} แถว',
    'tradeImage.doubtful': 'มี {count} แถวในกรอบแดงที่ต้องตรวจ',
    'check.done': 'ตรวจแล้ว',
    'check.waiting.one': 'ต้องตรวจอีก {count} แถว',
    'check.waiting.many': 'ต้องตรวจอีก {count} แถว',

    'tradeImage.checkAmount': 'โปรดตรวจจำนวนเงินและประเภท',
    'tradeImage.checkDate': 'โปรดตรวจวันที่และเวลา',
    'tradeImage.checkTicker': 'โปรดตรวจชื่อหุ้น',
    'tradeImage.same': 'มีรายการนี้อยู่แล้ว แถวนี้จะถูกข้าม',
    'tradeImage.fill': 'มีรายการนี้อยู่แล้ว จะเติมจำนวนหุ้นให้แถวเดิม',
    'tradeImage.similar': 'อาจซ้ำกับรายการเมื่อ {time} ถ้าใช่ให้ลบแถวนี้',
    'tradeImage.sameCount': 'มีอยู่แล้ว {count} แถว',
    'tradeImage.similarCount': 'อาจซ้ำ {count} แถว',
    'tradeImage.footer': 'ยังไม่ได้บันทึก และแถวที่มีอยู่แล้วจะถูกข้าม หน้า รายการ ไม่มีจำนวนหุ้น โปรดกรอกในรายการซื้อขายเพื่อให้หุ้นที่ถืออยู่คำนวณต่ออัตโนมัติ',
    'tradeImage.save': 'บันทึกทั้งหมด',
    'tradeImage.cancel': 'ยกเลิก',
    'tradeImage.confirmCancel': 'ทิ้งแถวเหล่านี้ใช่ไหม ยังไม่มีอะไรถูกบันทึก',

    'password.title': 'รหัสผ่าน',
    'password.new': 'รหัสผ่านใหม่',
    'password.hint': 'อย่างน้อย 12 ตัวอักษร',
    'password.save': 'บันทึกรหัสผ่าน',
    'password.saved': 'บันทึกรหัสผ่านแล้ว ใช้เข้าสู่ระบบได้ทุกอุปกรณ์',

    'account.title': 'บัญชี',
    'account.signedIn': 'เข้าสู่ระบบด้วย',
    'account.signOut': 'ออกจากระบบ',

    'login.tagline': 'ทุกการซื้อขายมีเรื่องราว',
    'login.email': 'อีเมล',
    'login.password': 'รหัสผ่าน',
    'login.signIn': 'เข้าสู่ระบบ',
    'login.link': 'ส่งลิงก์ทางอีเมลแทน',
    'login.signingIn': 'กำลังเข้าสู่ระบบ…',
    'login.sending': 'กำลังส่ง…',
    'login.checkEmail': 'ตรวจสอบลิงก์เข้าสู่ระบบในอีเมล แล้วเปิดในเบราว์เซอร์นี้',

    'csv.unknownType': 'ไม่รู้จักประเภท "{type}"',
    'csv.invalidDate': 'วันที่ไม่ถูกต้อง "{value}"',
    'csv.needsTicker': 'รายการ {type} ต้องมีชื่อหุ้นที่ถูกต้อง',
    'csv.invalidAmount': 'จำนวนเงินไม่ถูกต้อง "{value}"',
    'csv.wrongSign': 'จำนวนเงินของรายการ {type} มีเครื่องหมายบวกลบผิด',
    'csv.invalidShares': 'จำนวนหุ้นไม่ถูกต้อง "{value}"',
    'csv.noteTooLong': 'หมายเหตุยาวเกิน 500 ตัวอักษร',
    'csv.empty': 'ไฟล์ว่างเปล่า',
    'csv.missingColumn': 'ไม่พบคอลัมน์: {columns}',
    'csv.line': 'บรรทัด {line}: {error}',

  },
};

function savedLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function initialLanguage() {
  const saved = savedLanguage();
  if (LANGUAGES.some((item) => item.id === saved)) return saved;
  return globalThis.navigator?.language?.toLowerCase().startsWith('th') ? 'th' : 'en';
}

let language = initialLanguage();

export const currentLanguage = () => LANGUAGES.find((item) => item.id === language);

export function applyLanguage() {
  if (globalThis.document) document.documentElement.lang = language;
}

export function setLanguage(id) {
  language = id;
  applyLanguage();
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private windows can block storage, and the choice then lasts for this visit.
  }
}

export function t(key, params = {}) {
  const text = messages[language][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
}

export const plural = (key, count, params = {}) => t(
  `${key}.${count === 1 ? 'one' : 'many'}`,
  { ...params, count },
);
