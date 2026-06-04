const { checkOfficialPSPlusFeed, extractGameList, formatListText, processBlogContent } = require('./index');

describe('formatListText', () => {
  it('handles empty arrays', () => {
    expect(formatListText([])).toBe("> *None detected or formatting changed.*\n");
  });

  it('formats standard game lists correctly', () => {
    const input = ["Ghost of Tsushima", "Bloodborne"];
    const expected = "1. **Ghost of Tsushima**\n2. **Bloodborne**\n";
    expect(formatListText(input)).toBe(expected);
  });

  it('formats games with console pipes correctly', () => {
    const input = ["Destiny 2: Lightfall | PS4, PS5", "Tunic | PS4, PS5"];
    const expected = "1. **Destiny 2: Lightfall** | PS4, PS5\n2. **Tunic** | PS4, PS5\n";
    expect(formatListText(input)).toBe(expected);
  });
});

describe('extractGameList', () => {
  it('extracts games from standard pipe formatting', () => {
    const html = `<p>Some text</p>
    <p>Destiny 2 | PS4, PS5</p>
    <p>Tunic | PS4</p>`;
    expect(extractGameList(html)).toEqual(["Destiny 2 | PS4, PS5", "Tunic | PS4"]);
  });

  it('extracts games from li formatting as fallback', () => {
    const html = `<ul>
      <li>Ghost of Tsushima</li>
      <li>Bloodborne</li>
      <li>Last Chance to Play</li>
    </ul>`;
    expect(extractGameList(html)).toEqual(["Ghost of Tsushima", "Bloodborne"]);
  });

  it('extracts games from title fallback', () => {
    const html = "<p>No clear list here</p>";
    const title = "PlayStation Plus Monthly Games for May: FIFA 22, Tribes of Midgard, Curse of the Dead Gods";
    expect(extractGameList(html, title)).toEqual(["FIFA 22", "Tribes of Midgard", "Curse of the Dead Gods"]);
  });
});

describe('processBlogContent', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('processes Catalog posts and sends webhook successfully', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    process.env.DISCORD_WEBHOOK_URL = 'http://test.com';

    const post = {
      title: "PlayStation Plus Game Catalog for June",
      link: "http://example.com/blog",
      guid: "123",
      content: `<p><strong>PlayStation Plus Premium</strong></p>
      <p>Ghost of Tsushima | PS4, PS5</p>`
    };

    const result = await processBlogContent(post, "Catalog");
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.content).toContain('**PREMIUM:**');
    expect(payload.content).toContain('Ghost of Tsushima');
  });

  it('processes Essential posts and sends webhook successfully', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    process.env.DISCORD_WEBHOOK_URL = 'http://test.com';

    const post = {
      title: "PlayStation Plus Monthly Games for June: God of War, Naruto to Boruto: Shinobi Striker",
      link: "http://example.com/blog",
      guid: "456",
      content: "<p>Just text, relying on title fallback.</p>"
    };

    const result = await processBlogContent(post, "Essential");
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.content).toContain('**MONTHLY GAMES:**');
    expect(payload.content).toContain('God of War');
    expect(payload.content).toContain('Naruto to Boruto');
  });

  it('handles Discord rate limit (429)', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '0.1' }) })
      .mockResolvedValueOnce({ ok: true });

    process.env.DISCORD_WEBHOOK_URL = 'http://test.com';
    const post = { title: "Test", link: "link", content: "Test" };

    const result = await processBlogContent(post, "Essential");
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
