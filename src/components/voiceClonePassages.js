// Voice clone reading passages — all ElevenLabs-supported languages.
// Each array has 3 passages the user reads aloud for ~60s total.
// Fallback: if browser language not found, uses English.

const P = {
  en: [
    'Hi, my name is [your name] and I am recording this sample so that Kelion can speak in my voice. I give my explicit consent.',
    'The quick brown fox jumps over the lazy dog. She sells seashells by the seashore. Peter Piper picked a peck of pickled peppers.',
    "I understand this will be uploaded to ElevenLabs to create a voice clone tied only to my account, deletable at any time.",
  ],
  ro: [
    'Buna, numele meu este [numele tau] si inregistrez acest esantion pentru ca Kelion sa poata vorbi cu vocea mea. Imi dau consimtamantul explicit.',
    'Vulpea cea maro si rapida sare peste cainele lenes. Ea vinde scoici pe malul marii. Petru Piparul a adunat un pumn de ardei murati.',
    'Inteleg ca acest esantion va fi incarcat pe ElevenLabs pentru a crea o clona de voce legata doar de contul meu, pe care o pot sterge oricand.',
  ],
  fr: [
    "Bonjour, je m'appelle [votre nom] et j'enregistre cet echantillon pour que Kelion puisse parler avec ma voix. Je donne mon consentement explicite.",
    'Le renard brun rapide saute par-dessus le chien paresseux. Elle vend des coquillages sur le bord de la mer.',
    "Je comprends que cet echantillon sera telecharge sur ElevenLabs pour creer un clone vocal lie uniquement a mon compte.",
  ],
  de: [
    'Hallo, mein Name ist [Ihr Name] und ich nehme diese Probe auf, damit Kelion mit meiner Stimme sprechen kann. Ich gebe meine Zustimmung.',
    'Der schnelle braune Fuchs springt ueber den faulen Hund. Sie verkauft Muscheln am Meeresufer.',
    'Ich verstehe, dass diese Probe zu ElevenLabs hochgeladen wird und ich sie jederzeit loeschen kann.',
  ],
  es: [
    'Hola, mi nombre es [tu nombre] y estoy grabando esta muestra para que Kelion pueda hablar con mi voz. Doy mi consentimiento explicito.',
    'El rapido zorro marron salta sobre el perro perezoso. Ella vende conchas en la orilla del mar.',
    'Entiendo que esta muestra se subira a ElevenLabs y que puedo eliminarla en cualquier momento.',
  ],
  it: [
    'Ciao, il mio nome e [il tuo nome] e sto registrando questo campione affinche Kelion possa parlare con la mia voce. Do il mio consenso esplicito.',
    'La veloce volpe marrone salta sopra il cane pigro. Lei vende conchiglie sulla riva del mare.',
    'Capisco che questo campione sara caricato su ElevenLabs per creare un clone vocale legato solo al mio account.',
  ],
  pt: [
    'Ola, meu nome e [seu nome] e estou gravando esta amostra para que o Kelion possa falar com minha voz. Dou meu consentimento explicito.',
    'A rapida raposa marrom pula sobre o cao preguicoso. Ela vende conchas na beira do mar.',
    'Entendo que esta amostra sera enviada ao ElevenLabs para criar um clone de voz vinculado apenas a minha conta.',
  ],
  nl: [
    'Hallo, mijn naam is [uw naam] en ik neem dit voorbeeld op zodat Kelion met mijn stem kan spreken. Ik geef mijn uitdrukkelijke toestemming.',
    'De snelle bruine vos springt over de luie hond. Zij verkoopt schelpen aan het strand.',
    'Ik begrijp dat dit voorbeeld wordt geupload naar ElevenLabs om een stemkloon te maken die alleen aan mijn account is gekoppeld.',
  ],
  pl: [
    'Czesc, nazywam sie [twoje imie] i nagrywam ta probke, aby Kelion mogl mowic moim glosem. Wyrażam moja wyrazna zgode.',
    'Szybki brazowy lis przeskakuje nad leniwym psem. Ona sprzedaje muszle na brzegu morza.',
    'Rozumiem, ze ta probka zostanie przeslana do ElevenLabs w celu stworzenia klonu glosu powiazanego tylko z moim kontem.',
  ],
  sv: [
    'Hej, mitt namn ar [ditt namn] och jag spelar in detta prov sa att Kelion kan tala med min rost. Jag ger mitt uttryckliga samtycke.',
    'Den snabba bruna raven hoppar over den lata hunden. Hon saljer snackor vid stranden.',
    'Jag forstar att detta prov kommer att laddas upp till ElevenLabs for att skapa en rostklon kopplad till mitt konto.',
  ],
  da: [
    'Hej, mit navn er [dit navn] og jeg optager denne prove, sa Kelion kan tale med min stemme. Jeg giver mit udtrykkelige samtykke.',
    'Den hurtige brune rav springer over den dovne hund. Hun saelger muslingeskaller ved stranden.',
    'Jeg forstar at denne prove vil blive uploadet til ElevenLabs for at oprette en stemmeklon knyttet til min konto.',
  ],
  no: [
    'Hei, mitt navn er [ditt navn] og jeg tar opp denne prøven slik at Kelion kan snakke med min stemme. Jeg gir mitt uttrykkelige samtykke.',
    'Den raske brune reven hopper over den late hunden. Hun selger skjell ved stranden.',
    'Jeg forstar at denne proven vil bli lastet opp til ElevenLabs for a lage en stemmeklone knyttet til kontoen min.',
  ],
  fi: [
    'Hei, nimeni on [nimesi] ja tallennan taman naytteen, jotta Kelion voi puhua aanellani. Annan nimenomaisen suostumukseni.',
    'Nopea ruskea kettu hyppaa laiskan koiran yli. Han myy simpukoita merenrannalla.',
    'Ymmarran, etta tama naytte ladataan ElevenLabsiin aanikloonin luomiseksi, joka on sidottu vain tiliini.',
  ],
  cs: [
    'Ahoj, jmenuji se [vase jmeno] a nahravem tento vzorek, aby Kelion mohl mluvit mym hlasem. Davám svuj vyslovny souhlas.',
    'Rychla hneda liska skace pres leneho psa. Ona prodava mušle na plazi.',
    'Rozumim, ze tento vzorek bude nahran do ElevenLabs pro vytvoreni hlasoveho klonu vazaneho pouze k memu uctu.',
  ],
  hu: [
    'Szia, a nevem [a neved] es azert rogzitem ezt a mintat, hogy a Kelion az en hangommal tudjon beszelni. Kifejezett beleegyezesemet adom.',
    'A gyors barna roka atugrik a lusta kutya felett. Kagylokat arul a tengerparton.',
    'Megértem, hogy ez a minta feltoltesre kerul az ElevenLabs-ba, es barmikor torolhetem.',
  ],
  el: [
    'Geia, to onoma mou einai [to onoma sou] kai katografo auto to deigma gia na mporei o Kelion na milaei me ti foni mou.',
    'I grigori kafe alepou pidaei pano apo to tembeli skylo. Afti poulaei kohylia stin paralia.',
    'Katalavaino oti auto to deigma tha fortothei sto ElevenLabs kai mporo na to diagrapso opoiadipote stigmi.',
  ],
  bg: [
    'Zdraveite, imeto mi e [vasheto ime] i zapisvam tazi proba, za da mozhe Kelion da govori s moia glas. Davam izrichnoto si saglasie.',
    'Barzata kafyava lisitsa skachi nad marzhelivoto kuche. Tya prodava midalki na plazha.',
    'Razbiram, che tazi proba shte bade kachena v ElevenLabs i che moga da ya iztria po vsyako vreme.',
  ],
  hr: [
    'Bok, moje ime je [vase ime] i snimam ovaj uzorak kako bi Kelion mogao govoriti mojim glasom. Dajem svoj izriciti pristanak.',
    'Brza smedja lisica preskace lijenog psa. Ona prodaje skoljke na plazi.',
    'Razumijem da ce ovaj uzorak biti ucitan na ElevenLabs i da ga mogu obrisati u bilo kojem trenutku.',
  ],
  sk: [
    'Ahoj, volam sa [vase meno] a nahravaram tuto vzorku, aby Kelion mohol hovorit mojim hlasom. Davám svoj vyslovny suhlas.',
    'Rychla hneda liska skace cez lenivy psa. Ona predava mušle na plazi.',
    'Rozumiem, ze tato vzorka bude nahrana do ElevenLabs a ze ju mozem kedykolvek vymazat.',
  ],
  sl: [
    'Pozdravljeni, moje ime je [vase ime] in snemam ta vzorec, da bo Kelion lahko govoril z mojim glasom. Dajem svoje izrecno soglasje.',
    'Hitra rjava lisica skoci cez lenega psa. Ona prodaja skoljke na plazi.',
    'Razumem, da bo ta vzorec naložen na ElevenLabs in da ga lahko kadarkoli izbrisem.',
  ],
  uk: [
    'Pryvit, mene zvaty [vashe imya] i ya zapysuyu tsey zrazok, shchob Kelion mih hovorty moyim holosom. Ya dayu svoyu chítku zghodu.',
    'Shvydka korichnyeva lysytsya strybaye cherez ledacho sobaku. Vona prodaye cherepashky na plyazhi.',
    'Ya rozumiyu, shcho tsey zrazok bude zavantazheno na ElevenLabs i ya mozhu vydalyty yoho bud-koly.',
  ],
  ru: [
    'Privet, menya zovut [vashe imya] i ya zapisyvayu etot obrazets, chtoby Kelion mog govorit moim golosom. Ya dayu svoe yavnoe soglasie.',
    'Bystraya korichnevaya lisa pereprygívaet cherez lenivuyu sobaku. Ona prodaet rakushki na plyazhe.',
    'Ya ponimayu, chto etot obrazets budet zagruzhen na ElevenLabs i ya mogu udalit yego v lyuboe vremya.',
  ],
  tr: [
    'Merhaba, adim [adiniz] ve Kelion benim sesimle konusabilsin diye bu ornegi kaydediyorum. Acik rizami veriyorum.',
    'Hizli kahverengi tilki tembel kopegin uzerinden atlar. O sahilde deniz kabuklari satar.',
    'Bu ornegin ElevenLabs a yuklenecegini ve istedigim zaman silebilecegimi anliyorum.',
  ],
  ar: [
    'Marhaba, ismi [ismak] wa ana usajjil hadha al-ayina likay yastatiea Kelion al-tahadduth bisawti. Uati izni al-sarih.',
    'Al-thalab al-bunni al-sariea yaqfiz fawqa al-kalb al-kasul. Hiya tabieu al-sadaf ala shati al-bahr.',
    'Afham anna hadha al-ayina sayatim tahmiluha ila ElevenLabs wa yumkinuni hadhfuha fi ay waqt.',
  ],
  hi: [
    'Namaste, mera naam [aapka naam] hai aur main yeh sample record kar raha hoon taaki Kelion meri awaaz mein baat kar sake. Main apni sahmati deta hoon.',
    'Tez bhuri lomdi aalsi kutte ke upar kudti hai. Woh samundar ke kinaare seepiyaan bechti hai.',
    'Main samajhta hoon ki yeh sample ElevenLabs par upload hoga aur main ise kabhi bhi mita sakta hoon.',
  ],
  ja: [
    'Konnichiwa, watashi no namae wa [anata no namae] desu. Kelion ga watashi no koe de hanaseru you ni, kono sampuru wo rokuon shiteimasu.',
    'Subayai chairo no kitsune ga namakemono no inu no ue wo tobimasu. Kanojo wa kaigan de kai wo urimasu.',
    'Kono sampuru ga ElevenLabs ni appuroodo sareru koto wo rikai shiteimasu. Itsu demo sakujo dekimasu.',
  ],
  ko: [
    'Annyeonghaseyo, je ireumeun [dangsin-ui ireum] igo Kelion-i je mogsori-ro malhal su itdorok i saempeul-eul nogeum hago itsseumnida.',
    'Ppareun galsaek yeou-ga geureon gae wiro ttwieoneommnida. Geunyeoneun haetga-eseo jogaebikkeul palmnida.',
    'I saempeul-i ElevenLabs-e eoplodeu doego eonjedeunji sakje hal su itdaneun geot-eul ihae hamnida.',
  ],
  zh: [
    'Nihao, wo de mingzi shi [ni de mingzi], wo zhengzai luzhi zhege yangben, yi bian Kelion neng yong wo de shengyin shuohua.',
    'Kuaisu de zongse huoli tiao guo landuode gou. Ta zai haibian mai beiketanghulu.',
    'Wo lijie zhege yangben jiang bei shangchuan dao ElevenLabs, wo keyi suishi shanchu ta.',
  ],
  th: [
    'Sawasdee khrap, chue khong chan khue [chue khong khun] lae chan kamlang ban-theuk tuayang nee pheua hai Kelion samart phut duay siang khong chan.',
    'Soonakjing see namtan tua reo kradot kham sunakhon kee-kiat. Ther khai pleak hoi tee chai hat.',
    'Chan khaojai wa tuayang nee ja tueuk upload pai thi ElevenLabs lae chan samart lob man dai talot weela.',
  ],
  vi: [
    'Xin chao, ten toi la [ten cua ban] va toi dang ghi am mau nay de Kelion co the noi bang giong noi cua toi. Toi dong y ro rang.',
    'Con cao nau nhanh nhay qua con cho luoi bieng. Co ay ban vo so tren bai bien.',
    'Toi hieu rang mau nay se duoc tai len ElevenLabs va toi co the xoa no bat cu luc nao.',
  ],
  id: [
    'Halo, nama saya [nama Anda] dan saya merekam sampel ini agar Kelion dapat berbicara dengan suara saya. Saya memberikan persetujuan.',
    'Rubah coklat cepat melompati anjing malas. Dia menjual kerang di pantai.',
    'Saya memahami bahwa sampel ini akan diunggah ke ElevenLabs dan saya dapat menghapusnya kapan saja.',
  ],
  ms: [
    'Hai, nama saya [nama anda] dan saya merakam sampel ini supaya Kelion boleh bercakap dengan suara saya. Saya memberi persetujuan.',
    'Musang coklat pantas melompat atas anjing malas. Dia menjual kulit kerang di pantai.',
    'Saya faham bahawa sampel ini akan dimuat naik ke ElevenLabs dan saya boleh memadamkannya pada bila-bila masa.',
  ],
}

export default P
