# AquaDiagnose: Billing-Diagnose und Inbetriebnahme

## Nachgewiesener Stand vom 11.11.2026

- Repository und GitHub-Production-Deployment standen auf Commit `191a6fa`.
- `https://aquarium-wasserwerte-rechner.vercel.app/.well-known/assetlinks.json`
  war über Safari öffentlich erreichbar und enthielt nur den Fingerabdruck
  `12:68:02:E2:91:89:4D:EB:DF:65:5B:AA:10:B6:05:C2:77:2B:8B:9C:51:57:33:A2:C0:15:E8:A6:E2:70:AF:59`.
- Die per USB ausgelesene App `com.schwarzermarco14.aquadiagnose2`,
  Version `2.0.0.0` (`versionCode=2`), war durch `com.android.vending` installiert.
- `apksigner verify --print-certs` bestätigte an ihrer APK den SHA-256-Fingerabdruck
  `9A:13:E5:C4:BE:78:05:5A:D9:7D:78:AF:27:48:C2:23:9F:17:A3:26:1C:D0:D0:70:5A:0C:A0:17:81:72:83:4C`.
  Dieser fehlte in der produktiven Domain-Verknüpfung. `pm get-app-links` meldete
  für die Vercel-Domain den Fehlerstatus `1024`, keine erfolgreiche Verifizierung.
- Die APK enthält bereits Billing Library `8.3.0`, `PaymentActivity`,
  `PaymentService`, `DelegationService` und die Berechtigung `com.android.vending.BILLING`.
  Die Ressourcen nennen `PWABuilder` als Generator und die erwartete Vercel-Domain als Start-URL.
  Eine fehlende native Billing-Integration ist damit nicht der bestätigte Fehler.
- Im JavaScript wurde `getDigitalGoodsService()` mit der Store-Detailseite statt
  `https://play.google.com/billing` aufgerufen. Fehler leiteten auf `market://` um.
  Nach einem Kauf wurde Premium auf `false` gesetzt und trotzdem Erfolg gemeldet.

## Verursachende Commits

Alle Zeiten sind Ortszeit Berlin am 08.11.2026.

- `8d2a037` (09:19:32) führte den Digital-Goods-Kaufablauf zunächst mit der richtigen
  Dienstadresse `https://play.google.com/billing` und `isPremiumUser = true` nach dem Kauf ein.
  Serverseitige Prüfung und Bestätigung fehlten bereits dort.
- `f8d15dc` (09:50:30) ersetzte die richtige Dienstadresse durch die App-Store-Detailseite.
  Derselbe Commit setzte nach dem Kauf `isPremiumUser` und dessen gespeicherten Wert
  auf `false`, ließ aber die Erfolgsmeldung stehen. Zudem wurde bei jedem Fehler
  außer einem Kaufabbruch auf die Store-Seite umgeleitet.
- `25d4650` (10:08:55) trug die heutige Paket-ID mit genau dem Zertifikat ein,
  das jetzt an der APK auf dem Telefon gemessen wurde (`9A:13:…:83:4C`).
- `fb1cb65` (12:00:35) entfernte dieses passende Zertifikat und ersetzte es durch einen
  nur 20 Byte langen SHA-1-Fingerabdruck (`7B:AC:…:C6:EC`) im SHA-256-Feld.
  Der Commit-Titel nennt nur das Entfernen der Login-Credentials-Relation;
  die entscheidende Änderung am Zertifikat steht zusätzlich im Diff.
- `75e3adb`, `eba8ef8` und `7e225c2` wechselten danach Fingerabdruck bzw. Feldnamen,
  ohne das passende Zertifikat wiederherzustellen.
- `191a6fa` (14:47:49) stellte einen formal gültigen SHA-256-Wert ein (`12:68:…:AF:59`),
  der aber weiterhin nicht zur untersuchten APK passt.

Ein einzelner pauschaler Rollback behebt damit nicht alle Fehler: JavaScript und
Domain-Verknüpfung wurden in verschiedenen Commits beschädigt.

## Lokale Korrektur

Die Domain-Datei enthält zusätzlich die aus der installierten APK bestätigte
Signatur. Die bisherige Signatur bleibt erhalten; ihre Herkunft ist noch offen.
Vor dem Produktionsrelease beide Signaturen mit den tatsächlich vorgesehenen
App-Signatur- und ggf. internen App-Sharing-Zertifikaten in der Play Console abgleichen.

Der Kaufablauf prüft vorhandene Käufe, verwendet die korrekte Billing-Adresse und
zeigt Fehler ohne Store-Weiterleitung. Premium wird nur nach serverseitiger
Prüfung und Kaufbestätigung freigeschaltet. Vorhandene Käufe werden beim App-Start
erneut geprüft; ein manipulierbares `localStorage`-Flag gilt nicht als Kaufbeleg.
Aquarien und Tagebuchdaten bleiben lokal erhalten.

`api/google-play.js` ist eine Vercel Node.js Function. Sie prüft den Kaufstatus und
die Produkt-ID über Google Play und bestätigt neue Käufe. Das Produkt wird nicht
konsumiert, damit sich die Freischaltung wiederherstellen lässt.
Der Endpunkt setzt **einen dauerhaften Einmalkauf** `aquadiagnose_premium` voraus.
Für ein Abonnement ist die Verifizierung entsprechend anzupassen.

## Noch erforderliche Einrichtung

1. Im Google-Cloud-Projekt die Google Play Android Developer API aktivieren.
   Einen Service-Account mit Zugriff auf diese App in der Play Console einrichten;
   für Kaufprüfung und Bestätigung sind die entsprechenden Bestell-/Kaufrechte nötig.
2. In Vercel serverseitig `GOOGLE_PLAY_SERVICE_ACCOUNT` auf das vollständige
   Service-Account-JSON setzen. Der Schlüssel gehört weder ins HTML noch ins Git.
3. Änderungen auf Vercel veröffentlichen. Die Function benötigt Node.js 22 und
   `npm install`; das Web-Frontend bleibt statisches HTML.
4. `GET /api/google-play` muss mit HTTP 200 und `{"ready":true}` antworten.
   Dabei werden Google-Zugang und Zugriff auf den Produktkatalog geprüft.
   Ohne erreichbaren Prüfserver startet die App keinen neuen Kauf.
5. Auf der endgültigen Vercel-Domain die neue `assetlinks.json` prüfen.
   Auf dem verbundenen Telefon die Verifizierung erneut anstoßen:

   ```sh
   adb shell pm verify-app-links --re-verify com.schwarzermarco14.aquadiagnose2
   adb shell pm get-app-links com.schwarzermarco14.aquadiagnose2
   ```

   Die Verifizierung läuft asynchron; anschließend muss die Domain als `verified`
   erscheinen. Die App danach neu öffnen. Auch Chromes TWA-Verifizierung muss
   erfolgreich sein; der Android-App-Link-Status allein ersetzt diesen Test nicht.
6. Mit einem Lizenztester über den internen Play-Test prüfen: Produkt verfügbar,
   Testkauf, Kaufabbruch, ausstehende Zahlung, erneuter App-Start, Wiederherstellung.
   Dabei keine echten Zahlungen auslösen. Ein neues Android-Paket ist für die
   bestätigten Web-/Domain-Korrekturen zunächst nicht erforderlich.

## Prüfung

`npm test` prüft den Web-Ablauf mit simulierten Browser-APIs und die Function mit
simulierten Google-Antworten. Die Tests ersetzen keinen Kauf auf dem Android-Gerät.

Da alle Premium-Funktionen im ausgelieferten HTML liegen, kann ein technisch
versierter Nutzer die Oberfläche lokal manipulieren. Die serverseitige Kaufprüfung
ist keine Zugangssperre für bereits ausgelieferten JavaScript-Code. Beim späteren
Einführen von Konten oder geschützten Serverfunktionen müssen Käufe an das jeweilige
Konto gebunden und Berechtigungen für jede Serveraktion erneut geprüft werden.

## Quellen

- [Google: Play Billing in Trusted Web Activities](https://developer.chrome.com/docs/android/trusted-web-activity/receive-payments-play-billing)
- [Google: Kaufstatus prüfen](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2/getproductpurchasev2)
- [Google: Käufe bestätigen](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/acknowledge)
- [Google: Produktkatalog prüfen](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/get)
