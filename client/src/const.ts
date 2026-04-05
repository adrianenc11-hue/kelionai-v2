export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Always use standalone login page (email/password).
 */
export const getLoginUrl = () => {
  return "/login";
};
