let homeButton = document.querySelector('.home');
let itemDivs = document.querySelectorAll('.action-item');

homeButton.addEventListener('click', (e)=>{
    addToJira();
});

function addToJira(){
    for(i of itemDivs){
        console.log('Adding item to jira ' + item.innerText);
        jQuery.ajax({
            type: 'POST',
            url: 'https://anjumsalman.atlassian.net/rest/api/2/issue/',
            dataType: 'json',
            contentType: 'application/json',
            data: JSON.stringify({
                "fields": {
                   "project":
                   { 
                      "key": "COD"
                   },
                   "summary": i.innerText,
                   "description": "Contact BA",
                   "issuetype": {
                      "name": "Bug"
                   }
                  }
                }),
            username: 'anjum.salman@outlook.com',
            password: 'sa123321',
            success: function(e){
                console.log(e);
            }
        });
    }
}