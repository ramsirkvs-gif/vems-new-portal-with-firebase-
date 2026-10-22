/* Test-only Firebase contract double. Never included in index.html. */
(() => {
    const listeners = new Map();
    let sequence = 0;
    let user = null;
    let authListener = null;
    const snapshot = value => ({ val: () => value });
    window.testDeliver = (id, value) => listeners.get(id)?.(snapshot(value));
    window.testSetConnected = connected => {
        for (const [id, listener] of listeners) if (id.startsWith('.info/connected:')) listener(snapshot(connected));
    };
    const auth = {
        currentUser: null,
        onAuthStateChanged(listener) { authListener = listener; queueMicrotask(() => listener(user)); },
        async signInWithEmailAndPassword(email, password) {
            const result = await window.testSignIn(email, password);
            if (!result) throw Object.assign(new Error('Invalid test credentials'), { code: 'auth/invalid-credential' });
            const sameUser = user?.uid === result.uid;
            user = result;
            auth.currentUser = user;
            if (!sameUser) authListener?.(user);
            return { user };
        },
        async signOut() { user = null; auth.currentUser = null; authListener?.(null); },
        async sendPasswordResetEmail() { return; }
    };
    const db = {
        ref(path) {
            return {
                on(_, listener, fail) {
                    const id = `${path}:${sequence++}`;
                    listeners.set(id, listener);
                    window.testSubscribe(path, id, user?.uid).catch(error => fail?.(error));
                },
                off(_, listener) { for (const [id, next] of listeners) if (next === listener) listeners.delete(id); },
                push() { return { key: `test-student-${Date.now()}-${sequence++}` }; },
                async transaction(update) {
                    for (let attempt = 0; attempt < 10; attempt++) {
                        const before = await window.testRead(path);
                        const value = update(before.value);
                        if (value === undefined) return { committed: false };
                        const result = await window.testCommit(path, value, before.revision, user?.uid);
                        if (result.error) throw new Error(result.error);
                        if (result.committed) return { committed: true, snapshot: snapshot(value) };
                    }
                    throw new Error('Transaction retries exhausted');
                }
            };
        }
    };
    window.firebase = { initializeApp() {}, database: () => db, auth: () => auth };
})();
