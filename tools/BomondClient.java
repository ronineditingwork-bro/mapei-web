package ru.mapei.price;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Logs into lk.bomondceramica.ru and downloads the "Строительная химия" stock export (XML). Plain Java, no Android deps. */
public class BomondClient {
    static final String BASE = "https://lk.bomondceramica.ru";
    static final String AJAX = "/bitrix/services/main/ajax.php?mode=ajax&c=cetera%3A";

    // own jar: the site sets domain=bomondceramica.ru (no dot), which java.net.CookieManager rejects for lk.*
    private final Map<String, String> cookies = new LinkedHashMap<>();

    public static String fetchXml(String login, String password) throws IOException {
        return new BomondClient().run(login, password);
    }

    String run(String login, String password) throws IOException {
        Matcher s = Pattern.compile("bitrix_sessid['\"]?\\s*:\\s*['\"]([0-9a-f]{32})").matcher(request("/", null, null));
        if (!s.find()) throw new IOException("Сайт не отдал ключ сессии");
        String sessid = s.group(1);

        String r = request(AJAX + "auth&action=login", sessid,
                form("login", login, "password", password, "remember", "N", "sessid", sessid));
        if (!r.contains("\"success\":true")) throw new IOException("Не удалось войти: проверьте логин и пароль");

        // shortcut: category 3713 = "Строительная химия", property 511 = brand Mapei — copied from the site's own export call; update if the site changes them
        r = request(AJAX + "export&action=export", sessid, form(
                "filterData[filter][=PROPERTY_511][0]", "231228",
                "filterData[filter][FACET_OPTIONS][PRICE_FILTER]", "true",
                "filterData[categoryId]", "3713",
                "type", "xml", "isFavs", "N", "city", "c_all", "sessid", sessid));
        Matcher link = Pattern.compile("\"link\":\"([^\"]+)\"").matcher(r);
        if (!link.find()) throw new IOException("Выгрузка не удалась: " + r);
        String xml = request(link.group(1).replace("\\/", "/"), null, null);
        if (!xml.contains("<offers>")) throw new IOException("Неожиданный ответ выгрузки");
        return xml;
    }

    private String request(String path, String csrf, String body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(BASE + path).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 15) MAPEI-price");
        StringBuilder jar = new StringBuilder();
        for (Map.Entry<String, String> e : cookies.entrySet()) jar.append(e.getKey()).append('=').append(e.getValue()).append("; ");
        if (jar.length() > 0) c.setRequestProperty("Cookie", jar.toString());
        if (csrf != null) c.setRequestProperty("X-Bitrix-Csrf-Token", csrf);
        if (body != null) {
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = c.getResponseCode();
        List<String> set = c.getHeaderFields().get("Set-Cookie");
        if (set != null) for (String h : set) {
            String pair = h.split(";", 2)[0];
            int eq = pair.indexOf('=');
            if (eq > 0) cookies.put(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
        }
        if (code >= 400) throw new IOException("Сайт ответил ошибкой " + code);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    private static String form(String... kv) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < kv.length; i += 2)
            sb.append(i == 0 ? "" : "&").append(URLEncoder.encode(kv[i], "UTF-8")).append('=').append(URLEncoder.encode(kv[i + 1], "UTF-8"));
        return sb.toString();
    }

    /** Self-check: java BomondClient.java LOGIN PASSWORD [OUT.xml] — with OUT.xml it also saves the export (used by the iPhone site robot). */
    public static void main(String[] a) throws IOException {
        String xml = fetchXml(a[0], a[1]);
        int offers = xml.split("<offer ", -1).length - 1;
        if (offers == 0) throw new AssertionError("no offers");
        if (a.length > 2) java.nio.file.Files.write(java.nio.file.Paths.get(a[2]), xml.getBytes(StandardCharsets.UTF_8));
        System.out.println("OK offers=" + offers + " bytes=" + xml.length());
    }
}
