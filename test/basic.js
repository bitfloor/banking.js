var fs = require('fs');
var assert = require('assert');

var nock = require('nock');
var banking = require('../');

var bankInfo = {
  fid: 12345,
  fidorg: 'DI',
  url: 'https://example.com/ofx',
  bankid: 12345,
  user: 'username',
  pass: 'password',
  accid: 1234567890,
  acctype: 'CHECKING',
  date_start: 20010125,
  date_end: 20110125,
}

test('getStatement', function(done) {

  var bank = banking(bankInfo);

  var ofx_src = fs.readFileSync(__dirname + '/fixtures/sample.ofx', 'utf8');

  nock('https://example.com/')
  .defaultReplyHeaders({'Content-Type': 'application/x-ofx'})
  .filteringRequestBody(function() { return '*' })
  .post('/ofx', '*')
  .reply(200, ofx_src)

  //If second param is omitted JSON will be returned by default
  bank.getStatement(function (err, res) {
    if(err) {
      return done(err)
    }

    var status = res.OFX.SIGNONMSGSRSV1.SONRS.STATUS;
    assert.equal(status.CODE, 0);
    assert.equal(status.SEVERITY, 'INFO');
    assert.equal(res.OFX.SIGNONMSGSRSV1.SONRS.FI.ORG, 'WFB');
    assert.equal(res.OFX.SIGNONMSGSRSV1.SONRS.FI.FID, '3000');

    var trans = res.OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS;
    assert.equal(trans.CURDEF, 'USD');
    assert.equal(trans.BANKACCTFROM.BANKID, '000000000');

    var transactions = trans.BANKTRANLIST.STMTTRN;
    assert.equal(transactions.length, 11);

    assert.equal(transactions[0].TRNAMT, '-49.95');
    assert.equal(transactions[0].TRNTYPE, 'DEBIT');
    assert.equal(transactions[10].TRNAMT, '25.00');
    assert.equal(transactions[10].TRNTYPE, 'CREDIT');

    done();
  });
});

test('error', function(done) {
  var bank = banking(bankInfo);

  var ofx_src = fs.readFileSync(__dirname + '/fixtures/error.ofx', 'utf8');

  nock('https://example.com/')
  .defaultReplyHeaders({'Content-Type': 'application/x-ofx'})
  .filteringRequestBody(function() { return '*' })
  .post('/ofx', '*')
  .reply(200, ofx_src)

  //If second param is omitted JSON will be returned by default
  bank.getStatement(function (err, res) {
    assert.equal(err.message, 'Something Has Failed!');
    done();
  });
});

