const reply = (x, status = 200) => Response.json(x, { status, headers: { 'Cache-Control': 'no-store' } });
function fail(message) { throw Error(message); }
function pack(x) { if (!Array.isArray(x) || x.length < 1 || x.length > 12)
    fail('Нужно от 1 до 12 категорий'); return x.map((c) => ({ id: crypto.randomUUID(), name: String(c.name || '').trim().slice(0, 60) || 'Без названия', questions: (Array.isArray(c.questions) ? c.questions : []).slice(0, 8).map((q) => ({ id: crypto.randomUUID(), value: Math.max(1, Math.min(10000, Math.trunc(Number(q.value) || 100))), text: String(q.text || '').slice(0, 3000), answer: String(q.answer || '').slice(0, 2000), used: false })) })); }
function view(r, s, host, p) { if (host)
    return { ...s, players: s.players.map(({ token, ...p }) => p), id: r.id, invite: r.invite, version: r.version, host: true }; return { id: r.id, title: s.title, phase: s.phase, gate: s.gate, epoch: s.epoch, winner: s.winner, players: s.players.map(({ token, ...p }) => p), me: p?.id, blocked: s.blocked, host: false, version: r.version }; }
export async function handleGame(req, db, uid) {
    try {
        const origin = req.headers.get('origin');
        if (origin && origin !== new URL(req.url).origin)
            return reply({ error: 'Недопустимый источник' }, 403);
        const raw = await req.text();
        if (raw.length > 150000)
            return reply({ error: 'Слишком большой пакет' }, 413);
        const b = JSON.parse(raw);
        if (b.action === 'create') {
            if (!uid)
                return reply({ error: 'Войдите как ведущий, чтобы создать игру', signin: true }, 401);
            const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(), invite = crypto.randomUUID();
            const s = { title: String(b.title || 'Вечер в своей компании').slice(0, 80), categories: pack(b.categories), players: [], phase: 'lobby', gate: 'closed', epoch: 0, active: null, winner: null, blocked: [], history: [] };
            await db.prepare('INSERT INTO rooms (id,owner,invite,data,version) VALUES (?,?,?,?,0)').bind(id, uid, invite, JSON.stringify(s)).run();
            return reply(view({ id, invite, version: 0 }, s, true, null));
        }
        if (b.action === 'list') {
            if (!uid)
                return reply({ rooms: [] });
            const rows = await db.prepare('SELECT id,data FROM rooms WHERE owner=? ORDER BY created_at DESC LIMIT 20').bind(uid).all();
            return reply({ rooms: rows.results.map((r) => ({ id: r.id, title: JSON.parse(r.data).title })) });
        }
        for (let attempt = 0; attempt < 12; attempt++) {
            const r = await db.prepare('SELECT * FROM rooms WHERE id=?').bind(String(b.room || '').toUpperCase()).first();
            if (!r)
                return reply({ error: 'Комната не найдена' }, 404);
            const s = JSON.parse(r.data), host = !!uid && uid === r.owner && !b.token && b.action !== 'join';
            let p = s.players.find((p) => p.token === b.token);
            let joined = null;
            if (b.action === 'join') {
                if (b.invite !== r.invite)
                    return reply({ error: 'Приглашение недействительно' }, 403);
                if (!p) {
                    if (s.phase === 'finished')
                        fail('Игра завершена');
                    if (s.players.length >= 24)
                        fail('Комната заполнена');
                    const name = String(b.name || '').trim().slice(0, 24);
                    if (!name)
                        fail('Введите имя');
                    if (s.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
                        fail('Это имя уже занято');
                    p = { id: crypto.randomUUID(), token: crypto.randomUUID(), name, score: 0 };
                    s.players.push(p);
                }
                joined = p.token;
            }
            else {
                if (!host && !p)
                    return reply({ error: 'Нет доступа к комнате' }, 403);
                if (b.action === 'state')
                    return reply(view(r, s, host, p));
                if (b.action === 'buzz') {
                    if (!p)
                        fail('Нажимать могут только игроки');
                    if (s.phase !== 'playing' || s.gate !== 'open' || s.epoch !== b.epoch || s.blocked.includes(p.id))
                        fail('Кнопка уже закрыта');
                    s.winner = p.id;
                    s.gate = 'locked';
                }
                else {
                    if (!host)
                        return reply({ error: 'Только ведущий управляет игрой' }, 403);
                    if (b.version !== r.version)
                        return reply({ error: 'Состояние изменилось. Повторите действие.' }, 409);
                    const q = s.categories.flatMap((c) => c.questions).find((q) => q.id === s.active);
                    if (s.phase === 'finished')
                        fail('Игра завершена');
                    if (b.action === 'save') {
                        if (s.phase !== 'lobby')
                            fail('Редактирование доступно до начала игры');
                        s.categories = pack(b.categories);
                        s.title = String(b.title || s.title).slice(0, 80);
                    }
                    else if (b.action === 'start') {
                        if (s.phase !== 'lobby')
                            fail('Игра уже запущена');
                        if (!s.categories.every((c) => c.questions.length && c.questions.every((q) => q.text.trim() && q.answer.trim())))
                            fail('Заполните вопросы и ответы');
                        s.phase = 'playing';
                    }
                    else if (b.action === 'open') {
                        if (s.phase !== 'playing' || s.active)
                            fail('Сначала завершите текущий вопрос');
                        const nq = s.categories.flatMap((c) => c.questions).find((q) => q.id === b.question);
                        if (!nq || nq.used)
                            fail('Вопрос недоступен');
                        s.active = nq.id;
                        s.gate = 'closed';
                        s.winner = null;
                        s.blocked = [];
                        s.epoch++;
                    }
                    else if (b.action === 'arm') {
                        if (!q || s.winner)
                            fail('Сначала оцените ответ');
                        s.gate = 'open';
                        s.epoch++;
                    }
                    else if (b.action === 'judge') {
                        if (!q || !s.winner)
                            fail('Нет отвечающего игрока');
                        const player = s.players.find((p) => p.id === s.winner);
                        const delta = b.correct ? q.value : -q.value;
                        player.score += delta;
                        s.history.unshift({ id: crypto.randomUUID(), name: player.name, delta, label: b.correct ? 'Верный ответ' : 'Неверный ответ' });
                        s.blocked.push(player.id);
                        s.winner = null;
                        if (b.correct) {
                            q.used = true;
                            s.active = null;
                            s.gate = 'closed';
                        }
                        else {
                            s.gate = 'open';
                            s.epoch++;
                        }
                    }
                    else if (b.action === 'skip') {
                        if (q)
                            q.used = true;
                        s.active = null;
                        s.winner = null;
                        s.gate = 'closed';
                        s.epoch++;
                    }
                    else if (b.action === 'score') {
                        const p = s.players.find((p) => p.id === b.player);
                        const delta = Number(b.delta);
                        if (!p || !Number.isInteger(delta) || Math.abs(delta) > 10000)
                            fail('Некорректное изменение счёта');
                        p.score += delta;
                        s.history.unshift({ id: crypto.randomUUID(), name: p.name, delta, label: 'Корректировка ведущего' });
                    }
                    else if (b.action === 'finish') {
                        s.phase = 'finished';
                        s.gate = 'closed';
                        s.winner = null;
                        s.active = null;
                        s.epoch++;
                    }
                    else
                        fail('Неизвестное действие');
                }
            }
            s.history = s.history.slice(0, 100);
            const updated = await db.prepare('UPDATE rooms SET data=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(s), r.id, r.version).run();
            if (updated.meta.changes) {
                r.version++;
                return reply({ ...view(r, s, host, p), ...(joined ? { token: joined } : {}) });
            }
        }
        return reply({ error: 'Много одновременных действий. Попробуйте ещё раз.' }, 409);
    }
    catch (e) {
        if (e.code) {
            console.error('Database error', e.code);
            return reply({ error: 'Сервис временно недоступен. Попробуйте ещё раз.' }, 503);
        }
        return reply({ error: e.message || 'Ошибка запроса' }, 400);
    }
}
