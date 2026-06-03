process.env.DISCORD_WEBHOOK_URL = 'http://dummy.webhook.url';

const { extractGameList } = require('./index');

describe('extractGameList', () => {
  it('should extract games using the "| PS" strategy', () => {
    const htmlBlock = `
      <p>Ghost of Tsushima | PS4, PS5. This is a great game.</p>
      <div>Spider-Man: Miles Morales |PS4, PS5</div>
      <br>Ratchet & Clank | PS5.</br>
    `;
    const result = extractGameList(htmlBlock);
    expect(result).toEqual([
      'Ghost of Tsushima | PS4, PS5',
      'Spider-Man: Miles Morales |PS4, PS5',
      'Ratchet & Clank | PS5'
    ]);
  });

  it('should extract games using the <li> fallback strategy if no "| PS" is found', () => {
    const htmlBlock = `
      <ul>
        <li>Returnal. A fast-paced roguelike.</li>
        <li>Demon's Souls</li>
        <li>Last chance to play this game</li>
      </ul>
    `;
    const result = extractGameList(htmlBlock);
    expect(result).toEqual([
      'Returnal',
      "Demon's Souls"
    ]);
  });

  it('should extract games from the fallback title if both HTML strategies fail', () => {
    const htmlBlock = `<p>Check out our new monthly games!</p>`;
    const fallbackTitle = "PlayStation Plus Monthly Games: Sifu, Destiny 2 The Witch Queen, Hello Neighbor 2 and more";
    const result = extractGameList(htmlBlock, fallbackTitle);
    expect(result).toEqual([
      'Sifu',
      'Destiny 2 The Witch Queen',
      'Hello Neighbor 2'
    ]);
  });

  it('should handle HTML entities correctly', () => {
    const htmlBlock = `<p>Assassin&#8217;s Creed&#8212;Valhalla | PS4, PS5</p>`;
    const result = extractGameList(htmlBlock);
    expect(result).toEqual([
      "Assassin's Creed-Valhalla | PS4, PS5"
    ]);
  });

  it('should avoid duplicate games', () => {
    const htmlBlock = `
      <p>Duplicate Game | PS4</p>
      <p>Duplicate Game | PS4</p>
    `;
    const result = extractGameList(htmlBlock);
    expect(result).toEqual([
      'Duplicate Game | PS4'
    ]);
  });

  it('should ignore extremely short game names or empty strings', () => {
    const htmlBlock = `
      <ul>
        <li>A</li>
        <li>Valid Game</li>
      </ul>
    `;
    const result = extractGameList(htmlBlock);
    expect(result).toEqual([
      'Valid Game'
    ]);
  });

  it('should ignore games longer than 80 characters in the li strategy', () => {
    const htmlBlock = `
      <ul>
        <li>This string is extremely long and is definitely not just a game title because it contains a whole description that is well over eighty characters in length.</li>
        <li>Short Game</li>
      </ul>
    `;
    const result = extractGameList(htmlBlock);
    expect(result).toEqual([
      'Short Game'
    ]);
  });
});
