const claims = []
module.exports = {
  async getClaims(userId) {
    return claims.filter(claim => claim.userId === userId)
  },
  async getAllClaims() {
    return claims
  },
  async createClaim(userId, unitId) {
    if (claims.some(c => c.unitId === unitId)) {
      throw new Error(`Unit ${unitId} has already been claimed.`)
    }
    claims.push({userId, unitId})
  },
}
