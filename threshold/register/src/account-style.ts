/**
 * The account page stylesheet (C7-06). It is served from /register/account.css and linked, never inlined:
 * the CSP is style-src 'self'. It is a constant so the built service carries it without a static copy step.
 */
export const ACCOUNT_CSS = `body {
  font-family: system-ui, sans-serif;
  line-height: 1.5;
  margin: 0;
  padding: 1rem;
  max-width: 40rem;
}
label {
  display: block;
  margin: 0.5rem 0;
}
input,
select,
button {
  font-size: 1rem;
  max-width: 100%;
  padding: 0.5rem;
  box-sizing: border-box;
}
button {
  min-height: 2.5rem;
  margin: 0.25rem 0.25rem 0.25rem 0;
}
ul {
  padding-left: 1.25rem;
}
li {
  margin-bottom: 1.25rem;
}
.status {
  color: #333;
  font-size: 0.9rem;
}
`;
